// App languages and the translated strings for the shared chrome (nav, hero, section titles).
// Everything else on a page is translated in the browser from the translation memory
// (components/i18n/AutoTranslate.tsx, lib/translate.ts), so every page shows in the visitor's language.

// Languages the films are dubbed into (dub chips, audio and subtitle settings).
export const LANGS: [string, string][] = [
  ["en", "English"], ["yo", "Yorùbá"], ["ha", "Hausa"], ["ig", "Igbo"], ["fr", "Français"], ["hi", "हिन्दी"],
  ["ko", "한국어"], ["es", "Español"], ["pt", "Português"], ["de", "Deutsch"], ["ar", "العربية"], ["sw", "Kiswahili"],
];
// Languages the whole site, emails and receipts can be shown in.
export const APP_LANGS: [string, string][] = [
  ...LANGS,
  ["it", "Italiano"], ["nl", "Nederlands"], ["pl", "Polski"], ["ro", "Română"], ["el", "Ελληνικά"], ["cs", "Čeština"],
  ["hu", "Magyar"], ["sv", "Svenska"], ["da", "Dansk"], ["fi", "Suomi"], ["no", "Norsk"], ["uk", "Українська"], ["ru", "Русский"],
  ["tr", "Türkçe"], ["he", "עברית"], ["fa", "فارسی"], ["ur", "اردو"], ["bn", "বাংলা"], ["ta", "தமிழ்"], ["am", "አማርኛ"],
  ["so", "Soomaali"], ["zu", "isiZulu"], ["id", "Bahasa Indonesia"], ["ms", "Bahasa Melayu"], ["th", "ไทย"], ["vi", "Tiếng Việt"],
  ["ja", "日本語"], ["zh", "中文"],
];
export type Lang = string;
export const isLang = (v?: string | null): v is Lang => Boolean(v && APP_LANGS.some(([c]) => c === v));
export const langName = (code: string) => APP_LANGS.find(([c]) => c === code)?.[1] ?? "English";
export const englishName = (code: string) => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; }
};
const RTL = new Set(["ar", "he", "fa", "ur"]);
export const dirOf = (lang: string) => (RTL.has(lang) ? "rtl" : "ltr");

// The language a country reads most, for visitors who have not picked one. Countries where
// English is the everyday language of the web (Nigeria, Ghana, Kenya, India, the UK, the US...)
// stay in English; the visitor can switch in the language picker at any time.
const BY_COUNTRY: Record<string, string> = {
  // French
  FR: "fr", BE: "fr", LU: "fr", MC: "fr", CH: "de", SN: "fr", CI: "fr", ML: "fr", BF: "fr", NE: "fr", TG: "fr", BJ: "fr", GN: "fr",
  CM: "fr", GA: "fr", CG: "fr", CD: "fr", CF: "fr", TD: "fr", MG: "fr", DJ: "fr", KM: "fr", HT: "fr", BI: "fr",
  MA: "ar", DZ: "ar", TN: "ar", MR: "ar",
  // Arabic
  EG: "ar", SA: "ar", AE: "ar", QA: "ar", KW: "ar", BH: "ar", OM: "ar", JO: "ar", LB: "ar", SY: "ar", IQ: "ar", YE: "ar", LY: "ar",
  SD: "ar", PS: "ar",
  // Portuguese and Spanish
  PT: "pt", BR: "pt", AO: "pt", MZ: "pt", CV: "pt", GW: "pt", ST: "pt", TL: "pt",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es",
  PY: "es", SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", GQ: "es",
  // East Africa
  TZ: "sw", ET: "am", SO: "so",
  // Europe
  DE: "de", AT: "de", LI: "de", IT: "it", SM: "it", VA: "it", NL: "nl", PL: "pl", RO: "ro", MD: "ro", GR: "el", CY: "el", CZ: "cs",
  HU: "hu", SE: "sv", DK: "da", FI: "fi", NO: "no", UA: "uk", RU: "ru", BY: "ru", KZ: "ru", KG: "ru", TR: "tr",
  // Asia
  IL: "he", IR: "fa", AF: "fa", PK: "ur", BD: "bn", LK: "ta", KR: "ko", JP: "ja", CN: "zh", TW: "zh", HK: "zh", MO: "zh",
  ID: "id", MY: "ms", BN: "ms", TH: "th", VN: "vi",
};
export const langForCountry = (country?: string) => (country && BY_COUNTRY[country]) || "en";

const EN = {
  premieres: "Premieres",
  watchParties: "Watch parties",
  plans: "Plans",
  forBusiness: "For business",
  signIn: "Sign in",
  joinFree: "Join free",
  myHome: "My home",
  home: "Home",
  comingSoon: "Coming soon",
  calendar: "Calendar",
  live: "Live",
  worldPremiere: "WORLD PREMIERE",
  liveNow: "LIVE NOW",
  getASeat: "Get a seat",
  watchTrailer: "Watch trailer",
  addToCalendar: "Add to calendar",
  joinTheRoom: "Join the room",
  startWatchParty: "Start a watch party",
  howItWorks: "HOW IT WORKS",
  howTitle: "A cinema seat without the cinema",
  builtFor: "BUILT FOR WATCHING TOGETHER",
  builtTitle: "Everything a night out has, minus the traffic",
  plansEyebrow: "PLANS",
  plansTitle: "Choose how loud you want to be",
  compare: "Compare plans",
  payTitle: "Pay the way your country pays",
  watch: "Watch",
  account: "Account",
  company: "Company",
  help: "Help",
  welcome: "WELCOME",
  welcomeBack: "WELCOME BACK",
} as const;
export type Key = keyof typeof EN;

const T: Record<string, Partial<Record<Key, string>>> = {
  fr: {
    premieres: "Avant-premières", watchParties: "Soirées ciné", plans: "Abonnements", forBusiness: "Entreprises", signIn: "Se connecter",
    joinFree: "S'inscrire", myHome: "Mon espace", home: "Accueil", comingSoon: "Bientôt", calendar: "Calendrier", live: "En direct",
    worldPremiere: "PREMIÈRE MONDIALE", liveNow: "EN DIRECT", getASeat: "Réserver une place", watchTrailer: "Voir la bande-annonce",
    addToCalendar: "Ajouter au calendrier", joinTheRoom: "Rejoindre la salle", startWatchParty: "Lancer une soirée ciné",
    howItWorks: "COMMENT ÇA MARCHE", howTitle: "Une place de cinéma, sans le cinéma", builtFor: "FAIT POUR REGARDER ENSEMBLE",
    builtTitle: "Tout ce qu'offre une sortie, sans les bouchons", plansEyebrow: "ABONNEMENTS", plansTitle: "Choisissez votre niveau de voix",
    compare: "Comparer les abonnements", payTitle: "Payez comme on paie chez vous", watch: "Regarder", account: "Compte",
    company: "Entreprise", help: "Aide", welcome: "BIENVENUE", welcomeBack: "BON RETOUR",
  },
  es: {
    premieres: "Estrenos", watchParties: "Fiestas de cine", plans: "Planes", forBusiness: "Empresas", signIn: "Iniciar sesión",
    joinFree: "Únete gratis", myHome: "Mi inicio", home: "Inicio", comingSoon: "Próximamente", calendar: "Calendario", live: "En vivo",
    worldPremiere: "ESTRENO MUNDIAL", liveNow: "EN VIVO", getASeat: "Reservar asiento", watchTrailer: "Ver tráiler",
    addToCalendar: "Añadir al calendario", joinTheRoom: "Entrar a la sala", startWatchParty: "Organizar una fiesta de cine",
    howItWorks: "CÓMO FUNCIONA", howTitle: "Un asiento de cine sin el cine", builtFor: "HECHO PARA VER JUNTOS",
    builtTitle: "Todo lo de una noche fuera, sin el tráfico", plansEyebrow: "PLANES", plansTitle: "Elige cuánto quieres hablar",
    compare: "Comparar planes", payTitle: "Paga como se paga en tu país", watch: "Ver", account: "Cuenta", company: "Empresa",
    help: "Ayuda", welcome: "BIENVENIDO", welcomeBack: "BIENVENIDO DE NUEVO",
  },
  pt: {
    premieres: "Estreias", watchParties: "Sessões em grupo", plans: "Planos", forBusiness: "Empresas", signIn: "Entrar",
    joinFree: "Cadastre-se grátis", myHome: "Meu início", home: "Início", comingSoon: "Em breve", calendar: "Calendário", live: "Ao vivo",
    worldPremiere: "ESTREIA MUNDIAL", liveNow: "AO VIVO", getASeat: "Garantir lugar", watchTrailer: "Ver trailer",
    addToCalendar: "Adicionar ao calendário", joinTheRoom: "Entrar na sala", startWatchParty: "Criar sessão em grupo",
    howItWorks: "COMO FUNCIONA", howTitle: "Um lugar no cinema, sem o cinema", builtFor: "FEITO PARA ASSISTIR JUNTOS",
    builtTitle: "Tudo de uma noite fora, sem o trânsito", plansEyebrow: "PLANOS", plansTitle: "Escolha o quanto quer falar",
    compare: "Comparar planos", payTitle: "Pague do jeito do seu país", watch: "Assistir", account: "Conta", company: "Empresa",
    help: "Ajuda", welcome: "BEM-VINDO", welcomeBack: "BEM-VINDO DE VOLTA",
  },
  de: {
    premieres: "Premieren", watchParties: "Watch-Partys", plans: "Tarife", forBusiness: "Für Unternehmen", signIn: "Anmelden",
    joinFree: "Kostenlos beitreten", myHome: "Mein Bereich", home: "Start", comingSoon: "Demnächst", calendar: "Kalender", live: "Live",
    worldPremiere: "WELTPREMIERE", liveNow: "JETZT LIVE", getASeat: "Platz sichern", watchTrailer: "Trailer ansehen",
    addToCalendar: "Zum Kalender hinzufügen", joinTheRoom: "Saal betreten", startWatchParty: "Watch-Party starten",
    howItWorks: "SO FUNKTIONIERT'S", howTitle: "Ein Kinoplatz ohne Kino", builtFor: "GEMACHT FÜRS GEMEINSAME SCHAUEN",
    builtTitle: "Alles von einem Abend aus, ohne den Stau", plansEyebrow: "TARIFE", plansTitle: "Wie laut willst du sein?",
    compare: "Tarife vergleichen", payTitle: "Zahle so, wie dein Land zahlt", watch: "Schauen", account: "Konto",
    company: "Unternehmen", help: "Hilfe", welcome: "WILLKOMMEN", welcomeBack: "WILLKOMMEN ZURÜCK",
  },
  yo: {
    premieres: "Àwọn àfihàn tuntun", watchParties: "Ìwòran pọ̀", plans: "Àwọn ètò", forBusiness: "Fún ilé-iṣẹ́", signIn: "Wọlé",
    joinFree: "Darapọ̀ lọ́fẹ̀ẹ́", myHome: "Ilé mi", home: "Ilé", comingSoon: "Ń bọ̀ láìpẹ́", calendar: "Kàlẹ́ńdà", live: "Láàyè",
    worldPremiere: "ÀFIHÀN ÀGBÁYÉ", liveNow: "LÁÀYÈ BÁYÌÍ", getASeat: "Gba ìjókòó", watchTrailer: "Wo àkọ́wò",
    addToCalendar: "Fi kún kàlẹ́ńdà", joinTheRoom: "Wọ inú yàrá", startWatchParty: "Bẹ̀rẹ̀ ìwòran pọ̀",
    howItWorks: "BÍ Ó ṢE Ń ṢIṢẸ́", howTitle: "Ìjókòó sinimá láìsí sinimá", builtFor: "A ṢE É FÚN WÍWO PỌ̀",
    builtTitle: "Gbogbo ohun tí ìjáde alẹ́ ní, láìsí sún-kẹrẹ", plansEyebrow: "ÀWỌN ÈTÒ", plansTitle: "Yan bí o ṣe fẹ́ sọ̀rọ̀ tó",
    compare: "Fi àwọn ètò wéra", payTitle: "Sanwó bí orílẹ̀-èdè rẹ ṣe ń sanwó", watch: "Wò", account: "Àkáǹtì",
    company: "Ilé-iṣẹ́", help: "Ìrànlọ́wọ́", welcome: "Ẹ KÁÀBỌ̀", welcomeBack: "Ẹ KÚ ÀBỌ̀ PADÀ",
  },
  ha: {
    premieres: "Sabbin fina-finai", watchParties: "Kallo tare", plans: "Tsare-tsare", forBusiness: "Don kamfanoni", signIn: "Shiga",
    joinFree: "Shiga kyauta", myHome: "Gida na", home: "Gida", comingSoon: "Yana zuwa", calendar: "Kalanda", live: "Kai tsaye",
    worldPremiere: "FARKON NUNI A DUNIYA", liveNow: "KAI TSAYE YANZU", getASeat: "Sami kujera", watchTrailer: "Kalli tallan fim",
    addToCalendar: "Saka a kalanda", joinTheRoom: "Shiga daki", startWatchParty: "Fara kallo tare",
    howItWorks: "YADDA YAKE AIKI", howTitle: "Kujerar sinima ba tare da sinima ba", builtFor: "AN GINA SHI DON KALLO TARE",
    builtTitle: "Duk abin da fita dare ke da shi, ba cunkoso", plansEyebrow: "TSARE-TSARE", plansTitle: "Zabi yadda kake son magana",
    compare: "Kwatanta tsare-tsare", payTitle: "Biya yadda kasarku ke biya", watch: "Kallo", account: "Asusu",
    company: "Kamfani", help: "Taimako", welcome: "BARKA DA ZUWA", welcomeBack: "BARKA DA DAWOWA",
  },
  ig: {
    premieres: "Ihe nkiri ọhụrụ", watchParties: "Nlele ọnụ", plans: "Atụmatụ", forBusiness: "Maka azụmahịa", signIn: "Banye",
    joinFree: "Sonye n'efu", myHome: "Ụlọ m", home: "Ụlọ", comingSoon: "Na-abịa n'oge na-adịghị anya", calendar: "Kalịnda", live: "Ndụ",
    worldPremiere: "NGOSI MBỤ N'ỤWA", liveNow: "NA-AGA UGBU A", getASeat: "Nweta oche", watchTrailer: "Lee nkwalite",
    addToCalendar: "Tinye na kalịnda", joinTheRoom: "Banye n'ọnụ ụlọ", startWatchParty: "Malite nlele ọnụ",
    howItWorks: "OTU O SI ARỤ ỌRỤ", howTitle: "Oche sinima na-enweghị sinima", builtFor: "E MERE YA MAKA ILE ỌNỤ",
    builtTitle: "Ihe niile abalị pụọ nwere, na-enweghị mkpọchi ụzọ", plansEyebrow: "ATỤMATỤ", plansTitle: "Họrọ ka ị chọrọ ikwu okwu",
    compare: "Tụlee atụmatụ", payTitle: "Kwụọ ụgwọ ka obodo gị si akwụ", watch: "Lee", account: "Akaụntụ",
    company: "Ụlọ ọrụ", help: "Enyemaka", welcome: "NNỌỌ", welcomeBack: "NNỌỌ ỌZỌ",
  },
  sw: {
    premieres: "Maonyesho mapya", watchParties: "Kutazama pamoja", plans: "Mipango", forBusiness: "Kwa biashara", signIn: "Ingia",
    joinFree: "Jiunge bure", myHome: "Nyumbani kwangu", home: "Nyumbani", comingSoon: "Inakuja", calendar: "Kalenda", live: "Moja kwa moja",
    worldPremiere: "ONYESHO LA KWANZA DUNIANI", liveNow: "MUBASHARA SASA", getASeat: "Pata kiti", watchTrailer: "Tazama kionjo",
    addToCalendar: "Ongeza kwenye kalenda", joinTheRoom: "Ingia ukumbini", startWatchParty: "Anzisha kutazama pamoja",
    howItWorks: "JINSI INAVYOFANYA KAZI", howTitle: "Kiti cha sinema bila sinema", builtFor: "IMEJENGWA KWA KUTAZAMA PAMOJA",
    builtTitle: "Kila kitu cha usiku wa kutoka, bila foleni", plansEyebrow: "MIPANGO", plansTitle: "Chagua jinsi unavyotaka kuongea",
    compare: "Linganisha mipango", payTitle: "Lipa jinsi nchi yako inavyolipa", watch: "Tazama", account: "Akaunti",
    company: "Kampuni", help: "Msaada", welcome: "KARIBU", welcomeBack: "KARIBU TENA",
  },
  ar: {
    premieres: "العروض الأولى", watchParties: "حفلات المشاهدة", plans: "الباقات", forBusiness: "للشركات", signIn: "تسجيل الدخول",
    joinFree: "انضم مجاناً", myHome: "صفحتي", home: "الرئيسية", comingSoon: "قريباً", calendar: "التقويم", live: "مباشر",
    worldPremiere: "عرض عالمي أول", liveNow: "مباشر الآن", getASeat: "احجز مقعداً", watchTrailer: "شاهد الإعلان",
    addToCalendar: "أضف إلى التقويم", joinTheRoom: "ادخل القاعة", startWatchParty: "ابدأ حفلة مشاهدة",
    howItWorks: "كيف يعمل", howTitle: "مقعد سينما بلا سينما", builtFor: "صُمم للمشاهدة معاً",
    builtTitle: "كل ما في سهرة خارج البيت، بلا زحام", plansEyebrow: "الباقات", plansTitle: "اختر كم تريد أن تتكلم",
    compare: "قارن الباقات", payTitle: "ادفع بالطريقة المعتادة في بلدك", watch: "شاهد", account: "الحساب",
    company: "الشركة", help: "المساعدة", welcome: "أهلاً", welcomeBack: "أهلاً بعودتك",
  },
  hi: {
    premieres: "प्रीमियर", watchParties: "वॉच पार्टी", plans: "प्लान", forBusiness: "व्यवसाय के लिए", signIn: "साइन इन",
    joinFree: "मुफ़्त जुड़ें", myHome: "मेरा होम", home: "होम", comingSoon: "जल्द आ रहा है", calendar: "कैलेंडर", live: "लाइव",
    worldPremiere: "वर्ल्ड प्रीमियर", liveNow: "अभी लाइव", getASeat: "सीट लें", watchTrailer: "ट्रेलर देखें",
    addToCalendar: "कैलेंडर में जोड़ें", joinTheRoom: "रूम में जाएँ", startWatchParty: "वॉच पार्टी शुरू करें",
    howItWorks: "यह कैसे काम करता है", howTitle: "सिनेमा की सीट, बिना सिनेमा के", builtFor: "साथ देखने के लिए बना",
    builtTitle: "बाहर की शाम का सब कुछ, बिना ट्रैफ़िक के", plansEyebrow: "प्लान", plansTitle: "चुनिए आप कितना बोलना चाहते हैं",
    compare: "प्लान की तुलना करें", payTitle: "वैसे भुगतान करें जैसे आपका देश करता है", watch: "देखें", account: "खाता",
    company: "कंपनी", help: "मदद", welcome: "स्वागत है", welcomeBack: "फिर से स्वागत है",
  },
  ko: {
    premieres: "프리미어", watchParties: "함께 보기", plans: "요금제", forBusiness: "기업용", signIn: "로그인",
    joinFree: "무료 가입", myHome: "내 홈", home: "홈", comingSoon: "공개 예정", calendar: "캘린더", live: "라이브",
    worldPremiere: "월드 프리미어", liveNow: "지금 라이브", getASeat: "좌석 예매", watchTrailer: "예고편 보기",
    addToCalendar: "캘린더에 추가", joinTheRoom: "상영관 입장", startWatchParty: "함께 보기 시작",
    howItWorks: "이용 방법", howTitle: "극장 없이 극장 좌석을", builtFor: "함께 보기 위해 만들었습니다",
    builtTitle: "외출의 모든 것, 교통 체증만 빼고", plansEyebrow: "요금제", plansTitle: "얼마나 말하고 싶은지 고르세요",
    compare: "요금제 비교", payTitle: "내 나라 방식으로 결제", watch: "보기", account: "계정",
    company: "회사", help: "도움말", welcome: "환영합니다", welcomeBack: "다시 오신 것을 환영합니다",
  },
};

export function dict(lang: string): Record<Key, string> {
  return { ...EN, ...(T[lang] ?? {}) };
}

// "Yorùbá (AI dub)", "Hindi subtitles", "Original audio" for the Insights languages card.
export function trackLabel(code: string, kind: "audio" | "subs"): string {
  if (!code) return "Original audio";
  const name = APP_LANGS.find(([c]) => c === code.split("-")[0])?.[1] ?? code.toUpperCase();
  return kind === "audio" ? `${name} (AI dub)` : `${name} subtitles`;
}
