// The words our speech to text (Whisper, through the LLM gateway) should spell this site's way: place and mine names,
// geological terms, the platform's own names. Whisper reads a prompt as text that came before the speech, so a list of
// names nudges it to them; it keeps the last ~224 tokens, so each list stays short (about 600 characters).
export const STT_VOCAB: Record<string, string> = {
  en: "Kalgoorlie, Kambalda, Coolgardie, Norseman, Leonora, Laverton, Leinster, Meekatharra, Wiluna, Yilgarn, Pilbara, Hamersley, Fortescue, Kimberley, Gascoyne, Murchison, Paterson, Telfer, Tropicana, Boddington, Greenbushes, Mount Isa, Broken Hill, Olympic Dam, Tanami, Gawler, Lachlan, greenstone, komatiite, BIF, tenement, A-number, WAMEX, MINEDEX, GSWA, drillhole, RC, diamond core, assay, ppm, HyLogger, CoreFlagging, kaolinite, muscovite, chlorite, carbonate, hematite, goethite, SWIR, TIR, NVCL.",
  zh: "西澳大利亚, 卡尔古利, 坎巴尔达, 皮尔巴拉, 伊尔岗克拉通, 金伯利, 绿岩带, 科马提岩, 条带状铁建造, 矿权, 钻孔, 岩心, 化验, 金矿, 镍矿, 锂矿, 铜矿, 铁矿, 勘探报告, WAMEX, GSWA, 高岭石, 白云母, 绿泥石, 碳酸盐, 赤铁矿, 针铁矿, 短波红外。",
};
