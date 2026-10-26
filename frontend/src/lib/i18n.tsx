"use client";
/* Lightweight client-side i18n — no routing changes, no deps.
 *
 * One typed dictionary per locale; `useT()` returns a translator with {var}
 * interpolation. The choice persists in localStorage and defaults from the
 * browser language on first visit. Deep links / auth flows are untouched
 * (the URL never carries the locale).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Check, Globe } from "lucide-react";

export type Locale = "en" | "zh" | "fr" | "es" | "pt" | "id";
export const LOCALES: { key: Locale; label: string }[] = [
  { key: "en", label: "EN" },
  { key: "zh", label: "中文" },
  { key: "fr", label: "FR" },
  { key: "es", label: "ES" },
  { key: "pt", label: "PT" },
  { key: "id", label: "ID" },
];

const EN = {
  // ── landing: header / nav / CTAs ──
  "nav.features": "Features", "nav.metals": "Metals", "nav.about": "About",
  "nav.team": "Team", "nav.subscribe": "Subscribe",
  "cta.openMap": "Open the map", "cta.map": "Map", "cta.loadingWorkspace": "Loading workspace…",
  "cta.loading": "Loading…", "cta.browseMetals": "Browse metals",
  // ── hero ──
  "hero.badge": "Western Australia · geochemical prospectivity",
  "hero.title1": "Find where the minerals are,",
  "hero.title2": "grounded in real geochemistry.",
  "hero.sub": "MineTrace scores mineral prospectivity across WA for eight target metals — from GSWA stream-sediment and assay data. Click, draw, or just ask, and get an honest, evidence-backed read on any location.",
  "stats.metals": "target metals", "stats.pathfinders": "pathfinder elements",
  "stats.waWide": "WA-wide", "stats.surface": "prospectivity surface",
  // ── features ──
  "features.title": "Everything an explorer needs to reason about a target",
  "features.sub": "Four ways to interrogate the prospectivity surface — on the map, or through the assistant.",
  "features.f1t": "Score anywhere in WA",
  "features.f1b": "Click a point or draw a region and get a geochemistry-grounded prospectivity score — tier, coverage, nearest known deposit and the signals driving it.",
  "features.f2t": "Ask the assistant",
  "features.f2b": "A chat assistant that locates places, toggles layers, switches metals and scores locations for you — with its reasoning and evidence shown inline.",
  "features.f3t": "Find the top prospects",
  "features.f3b": "Read the computed surface to surface the highest-scoring, spatially-distinct regions for a metal — then compare them on real evidence, not just the score.",
  "features.f4t": "Layers & context",
  "features.f4b": "Overlay magnetics, gravity, structural worms, faults and known deposits to interpret a target the way an explorer would.",
  // ── metals section ──
  "metals.title": "Eight target metals",
  "metals.sub": "Pick one to jump straight into the map — you can switch metals anytime once you're there. Rare earth elements aren't a single metal and are outside the current 14-element model.",
  "metals.notSupported": "not supported", "metals.geochemModel": "geochem model",
  "metal.Au.blurb": "the headliner", "metal.Cu.blurb": "wires & pipes", "metal.Ni.blurb": "stainless steel",
  "metal.W.blurb": "toughest metal", "metal.Sn.blurb": "solder & cans", "metal.Co.blurb": "battery blue",
  "metal.Ta.blurb": "capacitors", "metal.Mn.blurb": "steel & cells",
  // ── about ──
  "about.title": "Built on public geoscience, honest about its limits",
  "about.body": "Prospectivity is scored by a geochemistry-only expert model over Geological Survey of Western Australia (GSWA) datasets. It's a decision-support and exploration tool — a starting point for where to look, not a substitute for fieldwork.",
  "about.d1t": "GSWA geochemistry", "about.d1b": "Stream-sediment & assay data across Western Australia.",
  "about.d2t": "Coverage-aware", "about.d2b": "Distinguishes real local evidence from interpolated estimates.",
  "about.d3t": "WA-only", "about.d3b": "The model covers Western Australia; it says so for anywhere else.",
  // ── team ──
  "team.title": "The team behind it",
  "team.subPre": "Researchers at", "team.subPost": ", The University of Western Australia — bringing knowledge graphs and AI to mineral exploration.",
  "team.viewProfile": "View profile", "team.leader": "Leader",
  "team.wei": "Knowledge graphs, generative AI & multimodal LLMs for knowledge discovery.",
  "team.yihao": "Multimodal LLMs, document analysis, information retrieval & question answering.",
  "team.yiran": "Knowledge graphs & AI for a data-to-knowledge platform across the critical-minerals value chain.",
  "team.pascal": "Knowledge graphs, KG-enhanced retrieval & knowledge discovery from unstructured data.",
  "team.daniel": "Multimodal foundation models & multi-task deep learning for mineral exploration.",
  "team.jinwen": "Knowledge graphs, multimodal AI & data-driven discovery for mineral exploration.",
  "team.chris": "Computational geoscience, numerical modelling & anomaly detection for geophysical and geochemical data.",
  // ── subscribe / CTA band / footer ──
  "sub.badge": "E-news", "sub.title": "Subscribe to our e-news",
  "sub.body": "Occasional updates on new datasets, metals and features — no spam, unsubscribe anytime.",
  "sub.button": "Subscribe", "sub.thanks": "Thanks — you're on the list. We'll be in touch.",
  "sub.privacy": "We'll only use your email to send MineTrace updates.",
  "band.title": "Ready to explore the surface?",
  "band.sub": "Open the map, drop a point, or ask the assistant where to look.",
  "footer.ack": "We acknowledge the Traditional Custodians of the lands across Western Australia and pay our respects to Elders past and present.",
  "footer.dataTitle": "Data", "footer.dataBody": "Geological Survey of Western Australia (GSWA) geochemistry.",
  "footer.dataNote": "Research & exploration decision-support tool.",
  "footer.partnerTitle": "In partnership with",
  "footer.partnerNote": "ARC Training Centre in Critical Resources for the Future.",
  // ── workspace: layer control ──
  "lc.basemap": "Basemap", "lc.satellite": "Satellite imagery", "lc.terrain3d": "3D terrain",
  "lc.layers": "Layers", "lc.colourBy": "Colour by", "lc.sampleType": "Sample type", "lc.logScale": "log", "lc.auDefault": "Gold (default)", "lc.exportEb": "Export EarthBank", "lc.exportEbHint": "The points inside the selected region as an EarthBank (AusGeochem) zip: samples.xlsx in the official template plus concentration CSVs",
  "hp.prospectivity": "The model's Composite Prospectivity Index (CPI) across WA — warmer colours mean geology more favourable to the selected metal.",
  "hp.sites": "Known mines and deposits for this metal — the positive examples the model learned from.",
  "hp.samples": "Geochemical assay sample sites (stream sediment, soil, rock chip, drillhole) — the model's raw evidence.",
  "hp.magnetics": "Airborne magnetic intensity (1VD = first vertical derivative) — highlights magnetic rocks and structures.",
  "hp.gravity": "Bouguer gravity — crustal density variations; highs often mark dense mafic/ultramafic rocks.",
  "hp.faults": "Mapped faults and structural lineaments — mineralisation often follows them.",
  "hp.score3d": "The same CPI shown as 3D column height instead of a flat colour surface.",
  "hp.metalstats": "The active metal, the assay samples and known deposits the model used, and its spatial AUC (map accuracy: 0.5 = random, 1 = perfect).",
  "hp.assistant": "Ask in plain language to locate places, score points or regions, compare spots, or find top prospects — it drives the map and scoring for you.",

  "hp.peaks": "Smooth shows the averaged surface; Peaks highlights the strongest local spots (max-pooled).",
  "hp.worms": "‘Worms’ are edges traced in magnetic/gravity data — they mark geological boundaries and structures at depth.",
  "hp.tenements": "Live and pending mining tenements (leases/licences) from DMIRS — who legally holds the ground.",
  "hp.wamex": "Footprints of open-file exploration reports lodged with WAMEX — where past exploration was done.",
  "hp.drillholes": "Open-file exploration drillhole collars; deeper holes are shown darker.",
  "hp.minedex": "Registered mines and deposits (Minedex), coloured by operating stage.",
  "hp.hist": "Historical exploration activities (drilling, geochemistry, geophysics) from past reports.",
  "hp.companyGeochem": "WAMEX company drillhole & surface geochemistry (GSWA, harmonised to ppm). Coloured by gold grade. Values carry NO quality control — verify against the original reports. Display only; not used in scoring.",
  "hp.timeslider": "Filter this layer to a year range. The bars show how much data exists each year.",
  "hp.tier": "CPI bands: Strong ≥62%, Moderate ≥55%, Weak ≥48%, otherwise Background.",
  "hp.boxplot": "Where this CPI sits among all WA grid cells for this metal — box = middle 50%, line = median, × = local max.",
  "hp.signals": "The features driving the CPI, in standard deviations (σ) above/below the regional background.",
  "hp.experts": "The model's sub-scores per data type, with each one's weight (w) in the CPI blend.",
  "hp.nearby": "What the display layers know within 10 km — tenure, reports, drillholes and known deposits.",
  "ov.geology": "Bedrock geology",
  "ov.regolith": "Regolith / cover",
  "ov.web3d": "3D geomodels",
  "ov.conservation": "Conservation reserves",
  "ov.nativeTitle": "Native title",
  "ov.pastoral": "Pastoral leases",
  "ov.heritage": "Aboriginal heritage",
  "lg.geology": "Geology & cover",
  "lg.access": "Land access",
  "nt.determination": "Determination",
  "nt.claim": "Claim",
  "hr.indicative": "Indicative — not a clearance",
  "hp.geology": "Interpreted bedrock geology (GSWA 1:500k) — the host rock. Hover a unit for its name.",
  "hp.regolith": "Regolith / weathering cover — whether the surface is bedrock or transported material, which changes how geochemistry is read.",
  "hp.web3d": "GSWA 3D geological models — subsurface units, faults and intrusions in true 3D. Click the 3D badge to open the interactive viewer; clicks inside the footprint still score as normal.",
  "hp.conservation": "DBCA conservation reserves (national parks, nature reserves) — generally a no-go for ground disturbance or pegging.",
  "hp.nativeTitle": "Native title determinations and claims — access usually needs an agreement with the native title party.",
  "hp.pastoral": "Pastoral lease stations — private land-access and notification obligations apply.",
  "hp.heritage": "Aboriginal heritage places — INDICATIVE only (boundaries are generalised). Presence is a prompt for formal DPLH due diligence, never a clearance.",
 "lc.results": "Model output", "lc.surfaceOpacity": "Surface opacity",
  "lc.meanShort": "Smooth", "lc.maxShort": "Peaks", "lc.peakMode": "Highlight peaks", "lc.surfMean": "Smooth (mean)", "lc.surfMax": "Peaks (max)",
  "ov.hillshade": "Terrain relief", "ov.sites": "Known sites", "ov.samples": "Sample points",
  "ov.surface": "Prospectivity surface", "ov.score3d": "Score columns (3D)",
  "ov.magnetics": "Magnetics (1VD)", "ov.gravity": "Gravity (Bouguer)",
  "lg.terrain": "Terrain", "lg.geophys": "Geophysics & structure", "lg.models3d": "3D models", "w3.open": "3D geology", "lg.model": "Model data", "lg.explo": "Exploration & mining", "lg.tenure": "Tenure", "ov.drillholes": "Drillholes (open file)", "ov.hist": "Historical exploration", "ov.wamex": "WAMEX report footprints",
  "mn.operating": "Operating", "mn.planned": "Proposed / developing", "mn.cm": "Care & maintenance", "mn.shut": "Shut", "mn.undeveloped": "Undeveloped",
  "ov.tenements": "Mining tenements", "ov.tenementsDead": "Dead tenements", "ov.minedex": "Minedex sites",
  "ov.companySurface": "Company surface geochem", "ov.companyCollars": "Company drillhole collars",
  "tn.live": "Live", "tn.pending": "Pending",
  "ov.faults": "Faults", "ov.wormMag": "Magnetic worms", "ov.wormGrav": "Gravity worms",
  "st.STREA": "Stream sediment", "st.ROCKC": "Rock chip", "st.DRILL": "Drillhole (max grade)",
  "st.SHALL": "Drillhole (shallow)", "st.SOIL": "Soil",
  // ── workspace: legend / result / stats ──
  "lg.prospectivity": "CPI", "lg.low": "low", "lg.high": "high",
  "lg.knownSites": "Known sites", "lg.selected": "Selected", "lg.located": "Located", "lg.scored": "Scored",
  "rp.prospectivity": "Prospectivity index (CPI)", "rp.regionalMedian": "Regional median",
  "rp.nearestSite": "nearest known site", "rp.interpretation": "Interpretation",
  "rp.expertBreakdown": "Expert breakdown", "rp.topSignals": "Top feature signals",
  "rp.gGeochemical": "Geochemical", "rp.gGeophysical": "Geophysical", "rp.gStructure": "Geological",
  "rp.region": "{g}/{c} grid points covered · range {min}–{max}%",
  "rp.nbrTrunc": "{shown} of {total} samples within {km} km highlighted (nearest first)",
  "rp.nbr": "{total} samples within {km} km highlighted",
  "cs.waLow": "WA low", "cs.waMedian": "WA median", "cs.waMax": "WA max", "cs.kmMax": "{km} km max",
  "cs.beats": "Higher than {p}% of WA",
  "cs.legScore": "score", "cs.legIqr": "mid 50%", "cs.legMedian": "median", "cs.iqr": "Middle 50% of WA (Q1–Q3)", "cs.you": "This score:",
  "tier.Strong": "Strong", "tier.Moderate": "Moderate", "tier.Weak": "Weak", "tier.Background": "Background",
  // ── workspace: live walk HUD / status / target menu ──
  "hud.liveWalk": "Live walk", "hud.locating": "Finding you… hold still a sec 📍",
  "hud.denied": "Location is blocked. Turn it on for this site in your browser / phone settings, then tap the GPS button again.",
  "hud.unavailable": "GPS isn't available on this device.",
  "hud.insecure": "Live walk needs a secure (https) connection.",
  "hud.walkIntoWA": "Walk into Western Australia to see live scores.",
  "hud.scoring": "Scoring your spot…", "hud.nearest": "Nearest",
  "hud.vibeStrong": "You're on strong {label} ground! 🔥", "hud.vibeDecent": "Decent {label} signal underfoot 👀",
  "hud.vibeModest": "Modest {label} potential here", "hud.vibeQuiet": "Quiet ground for {label}",
  "bs.live": "Live", "bs.deploying": "Deploying · back soon",
  "bs.titleUp": "Backend online", "bs.titleDown": "Backend redeploying — scores will resume shortly",
  "tm.targetMetal": "Target metal", "tm.backToStart": "← Back to start",
  "tm.counts": "{samples} samples · {sites} sites",
  // ── workspace: chat ──
  "ch.assistant": "Assistant", "ch.placeholder": "Ask the assistant…", "ch.details": "details",
  "lvl.HIGH": "HIGH", "lvl.MODERATE": "MODERATE", "lvl.LOW": "LOW",
  "ch.close": "Close", "ch.clear": "Clear history", "ch.collapse": "Collapse",
  "ch.layoutDock": "Floating chat", "ch.layoutSplit": "Chat beside the panel — drag the divider to resize",
  "ch.savePdf": "Save as PDF", "ch.share": "Share this chat", "ch.shareTitle": "Share this conversation", "ch.shareBody": "Anyone with the link can read this conversation and download it as a PDF. You can take the link back at any time.", "ch.yourMessage": "Your message", "ch.linkCopied": "Link copied", "ch.linkCopiedBody": "It is on your clipboard — paste it anywhere. Anyone with it can read this conversation and download the PDF, and you can take it back at any time.", "ch.alsoCan": "You can also", "ch.alsoCanBody": "Send the PDF itself, with a message. It arrives as an attachment, in your name, with your address to reply to — and the message is shown on the link above too.", "ch.pdfTooLarge": "This conversation is too large to email. Share the link instead.", "ch.pdfFailed": "The PDF could not be built. Try again.", "ch.badRecipients": "That does not look like an email address.", "ch.shareFailed": "Could not make a link. Try again.", "fb.title": "Send feedback", "fb.body": "Tell us what is wrong, or what you wish it did. It goes straight to the team.", "fb.problem": "Problem", "fb.idea": "Idea", "fb.other": "Other", "fb.placeholder": "What happened, and what did you expect instead?", "fb.note": "The page you are on and your browser version are sent with this, so we can reproduce it.", "fb.orEmail": "Or write to us directly:", "fb.send": "Send", "fb.sending": "Sending…", "fb.sent": "Thank you — we have it.", "fb.failed": "Could not send. Please try again.", "fb.tooMany": "That is a lot of feedback in one hour. Try again later.", "fb.signedOut": "Please sign in first.", "ch.shareLink": "Share link", "ch.copy": "Copy", "ch.copied": "Copied", "ch.revoke": "Revoke", "ch.emailIt": "Or email the PDF", "ch.recipients": "Recipient emails, comma separated", "ch.noteOptional": "Say why you are sending it (optional)", "ch.sendPdf": "Send the PDF", "ch.sending": "Sending…", "ch.sendPartial": "Could not send to {who}. Check the address and try again.", "ch.sentTo": "Sent to {who}", "ch.shareWarn": "It is sent from the platform, with your name and your address to reply to.", "ch.sendLimit": "You have reached today\u2019s sending limit.", "ch.sendFailed": "Could not send. Please try again.", "ch.shareCopy": "Copy the share link again", "ch.preparingPdf": "Preparing PDF…", "ch.removeContext": "Remove context",
  "ch.unreachable": "The assistant is temporarily unreachable — please try again.",
  "ch.error": "Something went wrong — please try again.",
  // ── PDF report (jsPDF-drawn chrome; card content is DOM-captured) ──
  "pdf.subtitle": "Prospectivity assistant - Western Australia",
  "pdf.overview": "Session overview", "pdf.covSummary": "Summary", "pdf.covMapCap": "All scored points and regions", "pdf.covCounts": "{p} scored points · {r} regions", "pdf.covList": "Scored locations", "pdf.conversation": "Conversation", "pdf.pointDetails": "Point details",
  "pdf.nearestSite": "NEAREST KNOWN SITE", "pdf.openOnMap": "Open on the map",
  "pdf.waReference": "WA REFERENCE", "pdf.details": "Details p.{n}",
  "pdf.latlon": "lat {lat}, lon {lon}",
  // ── PDF closing page: who built the platform (roster mirrors landing/team.tsx) ──
  "pdf.team": "Team", "pdf.teamTitle": "The team behind the platform",
  "pdf.teamIntro": "MineTrace and the research around it come from Theme 4 - Accelerating Geo-data Intelligence of the ARC Training Centre in Critical Resources for the Future (CCRF), and supported by the UWA Centre for Natural and Technical Language Processing (NTLP). Led by Associate Professor Wei Liu, Theme 4 takes a coordinated, Centre-wide approach to geo-data science for evidence-based discovery, characterisation and processing of critical minerals.",
  "pdf.teamMore": "More about the team",
  "pdf.tr.wei": "Theme Lead", "pdf.tb.wei": "Leads NTLP - the Centre for Natural and Technical Language Processing - and Theme 4 of the Training Centre, setting the direction that connects knowledge graphs, generative AI and multimodal LLMs to mineral exploration.",
  "pdf.tr.pascal": "Platform foundation", "pdf.tb.pascal": "Laid the platform foundation MineTrace runs on - built to support the models and the research still to come.",
  "pdf.tr.yihao": "Core research - MineTrace", "pdf.tb.yihao": "Core research on MineTrace: multimodal document understanding, information retrieval and question answering over the exploration archive.",
  "pdf.tr.yiran": "Core research - MineTrace", "pdf.tb.yiran": "Core research on MineTrace: knowledge graphs across the critical-minerals value chain, turning archive material into queryable knowledge.",
  "pdf.tr.jinwen": "Early proof of concept", "pdf.tb.jinwen": "Built the early proof of concept that established the approach, which then grew into this platform.",
  "pdf.tr.daniel": "Across both tracks", "pdf.tb.daniel": "Works across the research and platform tracks with multimodal foundation models, and extends the approach to further exploration use cases.",
  "pdf.tr.chris": "Data visualisation & geology advisor", "pdf.tb.chris": "Advises on data visualisation and brings a geologist's perspective to the platform - grounding how results are presented and read in geological practice.",
  "about.eyebrow": "About", "about.whoTitle": "Who built it",
  "about.mtLabel": "The research",
  "about.mtBody": "MineTrace is the mineral-prospectivity model behind every score on this platform. It reads the public exploration archive - GSWA geochemistry, geophysics and mapped structure - and turns it into a score that stays traceable to the evidence it came from.",
  "about.seriesLabel": "What comes next",
  "about.seriesTitle": "A platform built to carry more than one model",
  "about.seriesBody": "The platform does no scoring itself: it calls a research service over HTTP and plots what comes back. MineTrace is the first model on those rails - and they are built to carry the research that follows, so each new result reaches the people doing the exploring instead of stopping at a paper.",
  "about.ccrfEyebrow": "Part of an ARC Training Centre",
  "about.ccrfTheme": "Theme 4 - Accelerating Geo-data Intelligence",
  "about.af.wei": "NTLP, UWA - Theme 4 Lead, CCRF",
  "about.af.jinwen": "Undergraduate, Computer Science & Software Engineering, UWA",
  "about.af.yihao": "Postdoctoral Researcher, CCRF",
  "about.af.yiran": "PhD Candidate, CCRF",
  "about.af.pascal": "NTLP, UWA",
  "about.af.daniel": "PhD Candidate, UWA - collaborating with CCRF",
  "about.af.chris": "Research Fellow, CCRF & CET, UWA",
  // ── research hub ──
  "research.eyebrow": "Research", "research.title": "Research",
  "research.intro": "Our research connects data, evidence and reasoning. We develop methods for mineral prospectivity, document intelligence and natural-language access to databases. GeoPlatform provides a working geoscience environment in which these methods can be explored.",
  "research.ladder": "What grows out of it",
  "research.st.retrieval.t": "Retrieval", "research.st.retrieval.b": "Find the record, the page or the value. For example: text-to-SQL over the structured data, retrieval-augmented reading over the documents.",
  "research.st.reasoning.t": "Reasoning", "research.st.reasoning.b": "Combine the evidence into a judgement that stays traceable. For example: mineral prospectivity with MineTrace.",
  "research.st.reflection.t": "Reflection", "research.st.reflection.b": "Let the system revisit what it has read and scored, and surface knowledge no one entered by hand. For example: an exploration hypothesis drawn from patterns across thousands of reports.",
  "research.group.application": "Application", "research.group.foundation": "Foundation",
  "research.open": "Read more", "research.back": "All research",
  "research.minetrace.blurb": "A web-based mineral-prospectivity system with a traceable Composite Prospectivity Index (CPI), supporting evidence and LLM-assisted explanations.",
  "research.di.blurb": "Explore document collections at scale - the exploration archive, the scientific literature and the Geological Survey's publications - as structured, searchable knowledge with every fact linked back to its page.",
  "research.text2sql.blurb": "Make plain-language querying measurable on a private database - Acuity turns any schema into an annotation-free benchmark, then uses it to improve and deploy the search.",
  "pdf.teamAck": "Acknowledgement",
  "pdf.teamAckBody": "The research behind this platform, MineTrace, is supported by the ARC Training Centre in Critical Resources for the Future, under Theme 4 - Accelerating Geo-data Intelligence.",
  "pdf.teamGroup": "NTLP, UWA",
  "pdf.teamGroupBody": "The UWA Centre for Natural and Technical Language Processing (NTLP) researches entity recognition, knowledge graphs, ontologies and language models - and translates that research into software industry can actually use.",
  // ── map controls / email gate / question UI / live-walk errors ──
  "mc.compassHint": "Drag: sideways rotates, up/down tilts · click = north",
  "mc.liveWalk": "Live walk", "mc.stopLiveWalk": "Stop live walk",
  "mc.zoomIn": "Zoom in", "mc.zoomOut": "Zoom out",
  "mc.draw": "Draw region", "mc.backToPoint": "Back to point mode",
  "eg.title": "Enter your email to continue",
  "eg.bodyPre": "MineTrace is in", "eg.beta": "beta",
  "eg.bodyPost": ". You are in right away. We will email you a code to confirm your address — no password, no spam.",
  "eg.enter": "Enter the map", "eg.entering": "Entering…",
  "eg.note": "Enter the code we email you within 30 days to unlock the assistant and your own data. During beta, chats and scored locations are logged to improve the model and product.",
  "eg.useEmail": "Sign in with an email link",
  "eg.existsTitle": "Check your email", "eg.existsBody": "{email} already has an account, so we emailed a sign-in link there. Open it to sign in, or use your password.",
  "eg.existsNoMail": "{email} already has an account. Sign in with your password, or ask for a new link.",
  "eg.noMailHelp": "You can contact Pascal to sort this out:", "eg.otherEmail": "Use a different email",
  "eg.forgot": "Forgot your password?", "eg.resetTitle": "Reset your password",
  "eg.needEmail": "Enter your email first, then we can send the link.",
  "eg.forgotBody": "Enter your email and we will send you a sign-in link. Open it to sign in and set a new password.", "eg.sendReset": "Send reset link", "eg.backToPassword": "Back to password sign-in",
  "eg.resetBody": "We emailed a sign-in link to {email}. Open it and you will be signed in; then click your avatar (top right) → Account & password to set a new password.",
  "vp.resetBody": "You are signed in. Set your new password below.",
  "ve.linkBody": "We emailed a sign-in link to {email}. Open it to unlock the assistant and your own data. {days} days left.",
  "ve.expiredTitle": "Sign in with your link", "ve.expiredBody": "The first 7 days for {email} are over. Open the sign-in link we emailed you to keep using the map, or sign in with your password.",
  "ve.resendLink": "Email me a sign-in link", "ve.linkSent": "Sent. Check your inbox (and spam).", "ve.backToLink": "Back to the email link",
  "ch.verifyToChat": "Open your sign-in link to use the assistant", "ch.verifyNow": "Get link",
  "ac.unverified": "Sign-in link pending · {days} days left", "ac.expired": "Sign-in link needed", "ac.verifyNow": "Get a sign-in link",
  "acp.pwNeedsVerified": "Open your sign-in link first (it is in your inbox), or sign in with the password from the welcome email. Then you can change it here.",
  "vp.readyTitle": "Sign in", "vp.readyBody": "Click below to sign in on this device.", "vp.readySignIn": "Sign in", "vp.readyReset": "Sign in and set a new password",
  "vp.working": "Verifying…", "vp.ok": "You are signed in", "vp.okBody": "Taking you to the map…",
  "vp.pwTitle": "Your password", "vp.pwBody": "Your account now has a password. It is also in your email. Use it to sign in next time, or for the MCP connector. You can change it now.",
  "vp.copy": "Copy", "vp.change": "Change password",
  "vp.bad": "This link does not work", "vp.badBody": "It may have expired or already been used. Sign in and ask for a new link from the account menu.", "vp.toMap": "Go to the map",
  "eg.or": "or", "eg.usePassword": "Sign in with password", "eg.useCode": "Email me a code instead",
  "eg.noCode": "No code? Sign in with password", "eg.codeTitle": "Enter your code", "eg.codeBody": "We emailed a six-digit code to {email}. It has no link in it, so spam filters rarely touch it.", "eg.codeAria": "Six-digit code", "eg.verify": "Verify", "eg.verifying": "Verifying…", "eg.codeSent": "Code sent", "eg.checkSpam": "Not there? Check your spam or junk folder — Outlook and corporate mail filters often put it there.", "eg.setPwTitle": "Choose a new password", "eg.setPwBody": "Your email is confirmed. Pick a password — you will need it for the MCP connector; on the website your email alone is enough.", "eg.newPassword": "New password", "eg.savePw": "Save password", "eg.saving": "Saving…", "eg.skipPw": "Skip for now", "eg.resendCode": "Send another code", "eg.password": "Password",
  "eg.pwBody": "Enter your email and the account password from your welcome email (or the one you set on your account).",
  // ── verify email (private user data) ──
  "ve.title": "Use your sign-in link",
  "ve.bodyEmail": "Your own data is private to you, so we need to confirm this address once. We will email you a six-digit code.",
  "ve.bodyCode": "Enter the six-digit code we sent to {email}. It expires in 10 minutes.",
  "ve.send": "Send code", "ve.sending": "Sending…", "ve.verify": "Verify", "ve.verifying": "Verifying…",
  "ve.resend": "Use a different email or resend the code", "ve.codeAria": "Verification code",
  "ac.aria": "Account", "ac.signedInAs": "Signed in as", "ac.verified": "Email verified",
  "ac.account": "Account & password", "ac.signOut": "Sign out",
  "acp.title": "Your account", "acp.back": "Back to the map", "acp.email": "Email", "acp.verifiedOn": "Verified",
  "acp.pwTitle": "Password", "acp.pwBody": "Use it to sign in to the platform next time, or for the MCP connector login (ChatGPT, Claude and other agents). The welcome email holds the first one; set your own here.",
  "acp.pwNew": "New password", "acp.pwConfirm": "Confirm new password", "acp.pwMismatch": "The two passwords do not match.",
  "acp.pwSave": "Save password", "acp.pwSaving": "Saving…", "acp.pwSaved": "Password updated. Use it next time you sign in to the platform, or for the MCP login.",
  "acp.pwHint": "At least 8 characters, not just numbers, not too close to your email.",
  "acp.resetTitle": "Reset your password", "acp.resetBody": "Confirm your email with a six-digit code, then choose a new password.",
  "acp.resetDone": "Email confirmed. Now choose a new password below.",
  "acp.signedOut": "You are signed out.", "acp.signIn": "Sign in",
  "ws.sessionExpired": "Session expired — reopen the target.",
  "mt.thinking": "Thinking", "mt.thinkingLive": "Thinking…",
  "mt.showOnMap": "Show on map", "mt.openDetails": "Open full details",
  "mt.youChose": "You chose:", "mt.typeAnswer": "Type your answer…",
  "mt.send": "Send", "mt.other": "Other…",
  "ch.empty": "Ask about prospectivity anywhere in WA — e.g. “What's the Cu potential near Kalgoorlie?”",
  "ws.loadingMap": "Loading map…", "ws.backToStart": "Back to start", "ws.backHome": "Back to home", "rp.learnScience": "How the CPI is calculated", "ws.goTo": "Go to", "ws.modeMap": "Map",
  "mc.clear": "Clear", "eg.emailAria": "Email address",
  "lw.outsideWA": "You're outside the WA model area 🗺️",
  "lw.cantScore": "Couldn't score this spot",
  // ── chat stream (tool steps + evidence cards + injected notes) ──
  "ct.locate": "Locate", "ct.layers": "Layers", "ct.switch": "Switch", "ct.score": "Score", "ct.run": "Run",
  "ct.datasets": "Data layers", "ct.catalogue": "Database catalogue", "ct.inspect": "Inspect", "ct.query": "Query", "ct.chart": "Chart", "ct.openReport": "Open report", "ct.export": "Export",
  "ct.nLayers": "{n} exportable layers", "ct.nTables": "{n} tables in {s} schemas", "ct.nColumns": "{n} columns", "ct.nRows": "{n} rows", "ct.nPoints": "{n} points plotted", "ct.atPage": "page {p}", "ct.noReport": "no such report", "ct.openPanel": "Open in the side panel", "ct.source": "source",
  "ct.searchText": "Search reports", "ct.profile": "Profile", "ct.nPassages": "{n} passages in {r} reports", "ct.nDistinct": "{n} distinct values", "ct.sampledHits": "best of the first 400 matching pages", "ct.noMatch": "nothing matched", "ct.mapLayer": "Map", "ct.nFeatures": "{n} features drawn", "ct.noGeom": "no geometry",
  "ct.mapMoved": "map moved", "ct.noLocate": "couldn't locate", "ct.failed": "failed",
  "ct.noChange": "no change", "ct.show": "show", "ct.hide": "hide",
  "ct.targetMetal": "target metal", "ct.unknownMetal": "unknown metal",
  "ct.scoringFailed": "scoring failed", "ct.scoredSum": "scored",
  "ct.scoredCard": "Scored {label}", "ct.regionTag": " (region)",
  "ct.explHistory": "Exploration history", "ct.explReports": "{n} open-file reports ({years})", "ct.explNone": "none recorded", "nb.tenInside": "Inside tenement", "nb.tenNear": "Nearby tenements", "nb.tenDead": "Historical tenure (dead)", "nb.drill": "Drillholes nearby", "nb.drillLine": "deepest {d} m", "nb.activity": "Historical exploration activity", "nb.wxLoadAll": "show all {total}", "nb.wxNearCap": "showing the newest {shown} of {total}", "nb.wxNearby": "+{n} more nearby, not covering this point", "nb.fault": "Nearest mapped fault", "nb.assays": "GSWA geochem", "nb.assaysLine": "max Au {au} · Cu {cu} ppm", "nb.wormMag": "mag worm", "nb.wormGrav": "grav worm", "nb.openFull": "View full nearby data", "pdf.tenureExpl": "Tenure & exploration history", "nb.title": "Nearby data ({km} km)", "nb.loading": "Loading nearby data…", "nb.tenements": "Tenements", "nb.reports": "Exploration reports here", "nb.minedex": "Minedex sites nearby", "nb.coGeochem": "Company geochem", "nb.coSurfLine": "Surface {n} · max Au {au} ppm", "nb.coHoleLine": "holes {n} · max Au {au} ppm", "nb.coDepth": "{a}–{b} m downhole", "nb.coNoQc": "Harmonised ppm — no vendor QC, verify against reports", "nb.sites": "Known deposits nearby", "nb.none": "None within range", "nb.here": "here", "nb.more": "+{n} more", "nb.granted": "granted", "nb.expires": "expires", "nb.sitesNote": "Model training sites for this metal", "ch.dragHint": "Drag to move · edges resize · double-click to reset", "dc.short": "Model estimate — not exploration or investment advice.", "dc.full": "Research prototype. Scores are statistical estimates from public GSWA/DMIRS data and may be inaccurate; they are not exploration, financial or investment advice. Verify independently before acting.", "ct.tenure": "Tenure", "ct.openGround": "Open ground — no live tenement", "ct.nearestSite": "Nearest site", "ct.topSignals": "Top signals", "ct.expertBreakdown": "Expert breakdown", "ct.nearGeo": "Nearby geochem", "ct.coAu": "Company Au", "ct.gswaAu": "GSWA Au", "ct.bestIcpt": "best intercept", "ct.holes": "holes", "ct.mines": "mines",
  "ct.openInMap": "Open in map", "ct.interpolated": "interpolated",
  "ct.scoredMsg": "📍 Scored {label}{region} @ {where} — {pct}% ({tier}).",
  "ct.regionMedianTag": " (region median)",
  "gm.open": "Open in Google Maps",
  "ct.share": "Copy share link — opens this scored point in the recipient's own chat",
  "d3.open": "3D drillholes", "d3.delRegion": "Delete region", "d3.company": "Company", "d3.elev": "Elev", "d3.dotHint": "More dots = higher grade", "d3.bgHint": "Colour: rock type", "d3.controlsHint": "Drag: rotate · Right-drag: pan · Scroll: zoom", "d3.open2d": "2D log view", "d3.log2dTitle": "2D depth log", "d3.log2dNoElement": "Select at least one element to log.", "d3.log2dHole": "Hole", "d3.log2dInterval": "Interval", "d3.title": "3D drillholes", "d3.stat": "{h} holes · {i} intervals", "d3.capped": "capped", "d3.loading": "loading…", "d3.empty": "No drillhole data in this area.", "d3.error": "Failed to load.", "d3.grade": "{m} grade", "d3.best": "Best {m}", "d3.ivCount": "{n} intervals", "d3.depth": "Depth", "d3.noAssay": "Not logged", "d3.vex": "Vertical ×", "d3.radius": "Radius", "d3.close": "Close", "d3.lith": "Lithology", "d3.lithMafic": "Mafic (basalt/dolerite)", "d3.lithRegolith": "Regolith (weathered)", "d3.lithSaprock": "Saprock (transitional)", "d3.lithVein": "Vein", "d3.lithFelsic": "Felsic porphyry (altered)", "d3.lithTransported": "Transported cover", "d3.lithOther": "Other rock", "d3.lithNotRock": "Not rock (loss/waste)", "d3.attributes": "Attributes", "d3.geochem": "Geochem", "d3.geology": "Geology", "d3.geophysics": "Geophysics", "d3.alteration": "Alteration", "d3.veining": "Veining", "d3.mineralogy": "Mineralogy", "d3.structure": "Structure", "d3.intensity": "Intensity", "d3.filter": "Filter", "d3.filterId": "Search hole ID…", "d3.holeCap": "Max holes", "d3.filterClear": "Clear", "d3.filterMatch": "{n} of {m}", "d3.filterConditions": "Conditions", "d3.filterOr": "OR", "d3.filterAnd": "AND", "d3.filterHas": "Has data", "d3.filterRemove": "Remove condition", "d3.resetCamera": "Reset camera", "d3.underground": "Underground reconstruction", "d3.reconVolume": "Volume", "d3.reconRl": "Elevation range", "d3.predict": "Predict", "d3.predictHint": "Click a point on the reconstructed surface to predict a virtual drillhole", "d3.predictDisclaimer": "Predicted — not a resource estimate or drilling recommendation", "d3.predicted": "Predicted", "d3.predictedLog": "Predicted drillhole", } as const;

export type MsgKey = keyof typeof EN;
export type Dict = Record<MsgKey, string>;

// The other languages (~200 KB with their backend-text maps) live in i18n-locales.ts and load on demand;
// until they arrive, and on an English page always, text falls back to English.
const MESSAGES: Partial<Record<Locale, Dict>> = { en: EN };
let GEO_TEXT: Partial<Record<Exclude<Locale, "en">, Record<string, string>>> = {};
let loading: Promise<void> | null = null;
function loadLocales(): Promise<void> {
  loading ??= import("@/lib/i18n-locales").then((m) => { Object.assign(MESSAGES, m.MESSAGES); GEO_TEXT = m.GEO_TEXT; });
  return loading;
}

// Metal display names (backend sends English labels; known keys map per locale).
const METALS: Record<Locale, Record<string, string>> = {
  en: { Au: "Gold", Cu: "Copper", Ni: "Nickel", W: "Tungsten", Sn: "Tin", Co: "Cobalt", Ta: "Tantalum", Mn: "Manganese", REE: "Rare earths" },
  zh: { Au: "金", Cu: "铜", Ni: "镍", W: "钨", Sn: "锡", Co: "钴", Ta: "钽", Mn: "锰", REE: "稀土" },
  fr: { Au: "Or", Cu: "Cuivre", Ni: "Nickel", W: "Tungstène", Sn: "Étain", Co: "Cobalt", Ta: "Tantale", Mn: "Manganèse", REE: "Terres rares" },
  es: { Au: "Oro", Cu: "Cobre", Ni: "Níquel", W: "Tungsteno", Sn: "Estaño", Co: "Cobalto", Ta: "Tantalio", Mn: "Manganeso", REE: "Tierras raras" },
  pt: { Au: "Ouro", Cu: "Cobre", Ni: "Níquel", W: "Tungstênio", Sn: "Estanho", Co: "Cobalto", Ta: "Tântalo", Mn: "Manganês", REE: "Terras-raras" },
  id: { Au: "Emas", Cu: "Tembaga", Ni: "Nikel", W: "Wolfram", Sn: "Timah", Co: "Kobalt", Ta: "Tantalum", Mn: "Mangan", REE: "Tanah jarang" },
};

export function metalName(locale: Locale, key: string, fallback: string): string {
  return METALS[locale][key] ?? fallback;
}

export function tierName(locale: Locale, tier: string): string {
  const k = `tier.${tier}` as MsgKey;
  return ((MESSAGES[locale] ?? EN) as Record<string, string>)[k] ?? tier;
}

// ── context ───────────────────────────────────────────────────────────────────
const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "en", setLocale: () => {},
});

function detect(): Locale {
  try {
    const saved = localStorage.getItem("locale");
    if (saved === "en" || saved === "zh" || saved === "fr" || saved === "es" || saved === "pt" || saved === "id") return saved;
    const nav = navigator.language.toLowerCase();
    if (nav.startsWith("zh")) return "zh";
    if (nav.startsWith("fr")) return "fr";
    if (nav.startsWith("es")) return "es";
    if (nav.startsWith("pt")) return "pt";
    if (nav.startsWith("id") || nav.startsWith("in")) return "id"; // "in" = legacy Indonesian code
  } catch { /* SSR / privacy mode */ }
  return "en";
}

/** `fixed` pins one language whatever the browser or a saved choice says (a site with its pages in one language). */
export function LocaleProvider({ children, fixed }: { children: ReactNode; fixed?: Locale }) {
  // Start as "en" for a hydration-stable first paint, then adopt the detected locale.
  const [locale, setLocaleState] = useState<Locale>(fixed ?? "en");
  useEffect(() => { setLocaleState(fixed ?? detect()); }, [fixed]);
  // a non-English locale fetches its dictionary, then re-renders the tree in it
  const [, setLoaded] = useState(0);
  useEffect(() => { if (!MESSAGES[locale]) loadLocales().then(() => setLoaded((n) => n + 1)); }, [locale]);
  const setLocale = (l: Locale) => {
    if (fixed) return;
    setLocaleState(l);
    try { localStorage.setItem("locale", l); } catch { /* private mode */ }
  };
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

/** Translator: t("key") or t("key", {var: value}) for {var} interpolation. */
export function useT() {
  const { locale } = useContext(LocaleContext);
  return (key: MsgKey, vars?: Record<string, string | number>): string => {
    let s: string = MESSAGES[locale]?.[key] ?? EN[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** Compact language dropdown: a globe button that opens a small menu (EN / 中文 / FR). */
export function LangSwitcher({ align = "right" }: { align?: "left" | "right" }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
        title="Language"
        className={`flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800 ${open ? "bg-slate-900/5 text-slate-800" : ""}`}
      >
        <Globe size={14} />
        {/* icon-only on phones — the label only earns its width from sm up */}
        <span className="hidden uppercase sm:inline">{locale}</span>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span className={`absolute top-[calc(100%+6px)] z-50 flex w-28 flex-col rounded-xl border border-white/60 bg-white/95 p-1 shadow-glass-sm ring-1 ring-black/5 backdrop-blur-xl ${align === "right" ? "right-0" : "left-0"}`}>
            {LOCALES.map((l) => (
              <button
                key={l.key}
                onClick={() => { setLocale(l.key); setOpen(false); }}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs ${locale === l.key ? "font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-900/5"}`}
              >
                {l.label}
                {locale === l.key && <Check size={12} className="text-slate-700" />}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

// ── Backend template text localisation ────────────────────────────────────────
// The research service emits English template strings from FINITE sets (tier
// reasons, geophysics/structure feature labels, expert names). Map them exactly;
// anything unknown passes through unchanged. Geochem signal labels (element +
// statistic compositions) stay as-is — element symbols are language-neutral.

/** Localise a backend-emitted English template string (exact match, else substring
 *  replacement for the long tier reasons), passing unknown text through unchanged. */
export function geoText(locale: Locale, text: string): string {
  if (locale === "en" || !text) return text;
  const dict = GEO_TEXT[locale];
  if (!dict) return text; // not loaded yet
  if (dict[text]) return dict[text];
  let out = text;
  for (const [en2, tr] of Object.entries(dict)) {
    if (en2.length > 20 && out.includes(en2)) out = out.replace(en2, tr);
  }
  return out;
}

/** Localise an expert display name like "au pathfinder" or "magnetic geophysics":
 *  translate known tokens, keep element symbols/unknowns as-is. */
export function expertText(locale: Locale, name: string): string {
  if (locale === "en" || !name) return name;
  const dict = GEO_TEXT[locale];
  if (!dict) return name; // not loaded yet
  return name.split(" ").map((w) => dict[w] ?? (w.length <= 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Rotating verbs for the chat working indicator. */
const WORKING_WORDS: Record<Locale, string[]> = {
  en: ["Thinking", "Reasoning", "Locating", "Scoring", "Checking", "Gathering", "Considering", "Working", "Mapping"],
  zh: ["思考中", "推理中", "定位中", "评分中", "核对中", "收集中", "斟酌中", "处理中", "绘图中"],
  fr: ["Réflexion", "Raisonnement", "Localisation", "Évaluation", "Vérification", "Collecte", "Analyse", "Traitement", "Cartographie"],
  es: ["Pensando", "Razonando", "Localizando", "Evaluando", "Verificando", "Recopilando", "Analizando", "Procesando", "Mapeando"],
  pt: ["Pensando", "Raciocinando", "Localizando", "Pontuando", "Verificando", "Coletando", "Analisando", "Processando", "Mapeando"],
  id: ["Berpikir", "Menalar", "Mencari lokasi", "Menilai", "Memeriksa", "Mengumpulkan", "Menimbang", "Memproses", "Memetakan"],
};
export function workingWords(locale: Locale): string[] {
  return WORKING_WORDS[locale];
}

