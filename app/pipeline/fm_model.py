"""The CoreScope foundation model (inference only). Same layers and parameter names as fm/model.py in the research
code, so the trained weights load unchanged; training-only parts (losses, projection heads) are left out."""
import torch, torch.nn as nn, torch.nn.functional as F

SEQ_LEN = 256                                   # tokens (10 cm each) per window
CONV_CHANNELS, CONV_KERNEL, CONV_STRIDE = (32, 64, 96, 128), 7, 2
N_HEADS = 8


class SpecEnc(nn.Module):
    def __init__(self, nb, d):
        super().__init__(); ch = (2,) + tuple(CONV_CHANNELS); layers, L = [], nb
        for i in range(len(CONV_CHANNELS)):
            layers += [nn.Conv1d(ch[i], ch[i + 1], CONV_KERNEL, CONV_STRIDE, CONV_KERNEL // 2), nn.GroupNorm(8, ch[i + 1]), nn.GELU()]
            L = (L + 2 * (CONV_KERNEL // 2) - CONV_KERNEL) // CONV_STRIDE + 1
        self.net = nn.Sequential(*layers); self.out = nn.Linear(ch[-1] * L, d)

    def forward(self, x, bm):
        return self.out(self.net(torch.stack([x.masked_fill(bm, 0.0), bm.to(x.dtype)], 1)).flatten(1))


def rope(x, pos, inv_freq):
    ang = pos[:, None, :, None].to(x.dtype) * inv_freq; cos, sin = ang.cos(), ang.sin(); a, b = x[..., 0::2], x[..., 1::2]
    return torch.stack([a * cos - b * sin, a * sin + b * cos], -1).flatten(-2)


class Block(nn.Module):
    def __init__(self, d, h):
        super().__init__(); self.h = h; self.n1 = nn.LayerNorm(d); self.qkv = nn.Linear(d, 3 * d); self.proj = nn.Linear(d, d); self.n2 = nn.LayerNorm(d)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d)); self.drop = nn.Dropout(0.0)
        self.register_buffer("inv_freq", 1.0 / (10000 ** (torch.arange(0, d // h, 2).float() / (d // h))), persistent=False)

    def forward(self, x, pos, keep):
        B, T, D = x.shape; q, k, v = self.qkv(self.n1(x)).view(B, T, 3, self.h, D // self.h).permute(2, 0, 3, 1, 4)
        q, k = rope(q, pos, self.inv_freq), rope(k, pos, self.inv_freq)
        a = F.scaled_dot_product_attention(q, k, v, attn_mask=keep[:, None, None, :])
        x = x + self.proj(a.transpose(1, 2).reshape(B, T, D)); return x + self.mlp(self.n2(x))


class CoreFM(nn.Module):
    def __init__(self, nb_s, nb_t, d=256, layers=8, heads=N_HEADS):
        super().__init__(); self.enc_s, self.enc_t = SpecEnc(nb_s, d), SpecEnc(nb_t, d)
        self.tok = nn.Parameter(torch.zeros(3, d))
        self.aux = nn.Sequential(nn.Linear(4, d), nn.GELU(), nn.Linear(d, d)); self.inst = nn.Embedding(4, d)
        self.blocks = nn.ModuleList([Block(d, heads) for _ in range(layers)]); self.norm = nn.LayerNorm(d)
        self.head_s = nn.Sequential(nn.Linear(d, 2 * d), nn.GELU(), nn.Linear(2 * d, nb_s)); self.head_t = nn.Sequential(nn.Linear(d, 2 * d), nn.GELU(), nn.Linear(2 * d, nb_t))

    def forward(self, b, m=None):
        """b: swir [B,T,nb_s], tir [B,T,nb_t] (standardised), pos [B,T] bin offsets, has_tir, pad [B,T] bool, aux [B,T,4], inst [B].
        m (optional): hide_s / hide_t [B,T] bool, band_s / band_t [B,T,nb] bool. Returns (representation, rebuilt SWIR, rebuilt TIR)."""
        B, T, _ = b["swir"].shape; z = torch.zeros(B, T, dtype=torch.bool, device=b["swir"].device)
        hs, ht = (m["hide_s"], m["hide_t"]) if m else (z, z); bs = m["band_s"] if m else torch.zeros_like(b["swir"], dtype=torch.bool); bt = m["band_t"] if m else torch.zeros_like(b["tir"], dtype=torch.bool)
        es = self.enc_s(b["swir"].flatten(0, 1), bs.flatten(0, 1)).view(B, T, -1); et = self.enc_t(b["tir"].flatten(0, 1), bt.flatten(0, 1)).view(B, T, -1)
        es = torch.where(hs[..., None], self.tok[0].to(es.dtype), es)
        et = torch.where(hs.new_ones(B, T)[..., None] & ~b["has_tir"][..., None], self.tok[2].to(et.dtype), et); et = torch.where((ht & b["has_tir"])[..., None], self.tok[1].to(et.dtype), et)
        aux = b["aux"].masked_fill(torch.stack([hs, ht, hs, ht], -1), 0.0)
        x = es + et + self.aux(aux) + self.inst(b["inst"])[:, None]
        for blk in self.blocks:
            x = blk(x, b["pos"], ~b["pad"])
        x = self.norm(x); return x, self.head_s(x), self.head_t(x)
