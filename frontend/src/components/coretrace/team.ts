import type { MsgKey } from "@/lib/i18n";

/** The people behind CoreFlagging, for the landing page and the report. Blurbs are the platform's (i18n). */
export const CORE_TEAM: { name: string; img: string; href: string; blurb: MsgKey; leader?: boolean }[] = [
  { name: "Wei Liu", leader: true, img: "/team/wei.jpg", href: "https://research-repository.uwa.edu.au/en/persons/wei-liu/", blurb: "team.wei" },
  { name: "Yihao Ding", img: "/team/yihao.jpg", href: "https://research-repository.uwa.edu.au/en/persons/yihao-ding/", blurb: "team.yihao" },
  { name: "Pascal Sun", img: "/team/pascal.jpg", href: "https://pascalsun.github.io/", blurb: "team.pascal" },
  { name: "Daniel Su", img: "/team/daniel.jpg", href: "https://criticalresources.org.au/contributor/uwa-daniel-su/", blurb: "team.daniel" },
  { name: "Yiran (Grant) Zhang", img: "/team/yiran.jpg", href: "https://www.linkedin.com/in/yiran-grant-zhang/", blurb: "team.yiran" },
];
