"""Names shown in the app. Copied from the research code (regions/build_summary.py, eval/segments.py) so wording matches
the evaluation page and the segment CSVs."""
import re

ZH = {"CHLORITE": "绿泥石", "WHITE-MICA": "白云母", "SILICA": "石英", "PLAGIOCLASE": "斜长石", "AMPHIBOLE": "角闪石", "INVALID": "无响应", "KAOLIN": "高岭石",
      "DARK-MICA": "黑云母", "CARBONATE": "碳酸盐", "SMECTITE": "蒙脱石", "K-FELDSPAR": "钾长石", "PYROXENE": "辉石", "SERPENTINE": "蛇纹石", "SULPHATE": "硫酸盐",
      "EPIDOTE": "绿帘石", "OTHER-MGOH": "其他含镁矿物", "OTHER-ALOH": "其他含铝矿物", "TOURMALINE": "电气石", "OLIVINE": "橄榄石", "GARNET": "石榴石",
      "PHOSPHATE": "磷酸盐", "OXIDE": "氧化物", "FE-OXIDE": "铁氧化物", "ZEOLITE": "沸石", "OTHER": "其他"}
MS_ZH = {"Chlorite-FeMg": "铁镁绿泥石", "Aspectral": "无短波红外响应", "Muscovite": "白云母", "Hornblende": "角闪石", "Phengite": "多硅白云母", "Biotite": "黑云母",
         "Chlorite-Mg": "镁绿泥石", "Dolomite": "白云石", "Kaolinite-WX": "结晶差的高岭石", "Chlorite-Fe": "铁绿泥石", "Paragonite": "钠云母", "Kaolinite-PX": "结晶好的高岭石",
         "Montmorillonite": "蒙脱石", "Phlogopite": "金云母", "Talc": "滑石", "Serpentine": "蛇纹石", "Calcite": "方解石", "Ankerite": "铁白云石", "Actinolite": "阳起石",
         "MuscoviticIllite": "白云母质伊利石", "PhengiticIllite": "多硅白云母质伊利石", "Gypsum": "石膏", "Epidote": "绿帘石", "Siderite": "菱铁矿", "Nontronite": "绿脱石",
         "Riebeckite": "钠闪石", "Saponite": "皂石", "Dickite": "地开石", "ParagoniticIllite": "钠云母质伊利石", "Prehnite": "葡萄石", "Nacrite": "珍珠陶土", "Pyrophyllite": "叶蜡石",
         "Tourmaline-Fe": "铁电气石", "Tremolite": "透闪石", "Magnesite": "菱镁矿", "Zoisite": "黝帘石", "Jarosite": "黄钾铁矾", "Alunite-Na": "钠明矾石"}
MS_EN = {"Aspectral": "no SWIR response", "Kaolinite-WX": "poorly crystalline kaolinite", "Kaolinite-PX": "well crystalline kaolinite", "Chlorite-FeMg": "Fe-Mg chlorite",
         "Chlorite-Mg": "Mg chlorite", "Chlorite-Fe": "Fe chlorite", "MuscoviticIllite": "muscovitic illite", "PhengiticIllite": "phengitic illite", "ParagoniticIllite": "paragonitic illite"}
GT_EN = {"SILICA": "quartz", "PLAGIOCLASE": "plagioclase", "K-FELDSPAR": "K-feldspar", "AMPHIBOLE": "amphibole", "CARBONATE": "carbonate", "PYROXENE": "pyroxene",
         "CHLORITE": "chlorite", "WHITE-MICA": "white mica", "KAOLIN": "kaolin", "SULPHATE": "sulphate", "OTHER-MGOH": "other Mg-OH minerals", "SMECTITE": "smectite", "SERPENTINE": "serpentine"}
MICA = {"Muscovite", "Phengite", "Paragonite", "MuscoviticIllite", "PhengiticIllite", "ParagoniticIllite"}
CHL = {"Chlorite-FeMg", "Chlorite-Mg", "Chlorite-Fe"}
NONROCK = {"WhiteMarker", "PlasticChipTray", "Vegetation-Dry", "Wood", "IsaWhite", "NotInLibrary", "nan", "None", ""}
BAD = {"INVALID", "NOTAROK", "None", "nan", "null", ""}
GS_ZH = ZH          # software SWIR / TIR mineral groups share one dictionary

ms_zh = lambda m: MS_ZH.get(m, m)
ms_en = lambda m: MS_EN.get(m, re.sub(r"(?<!^)(?=[A-Z])", " ", m).lower())
gt_zh = lambda g: ZH.get(g, g.title())
gt_en = lambda g: GT_EN.get(g, g.lower())
