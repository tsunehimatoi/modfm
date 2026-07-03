export function getBaseHead(lang: string) {
  return {
    htmlAttrs: {
      lang,
    },
    meta: [
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1.0",
      },
      {
        name: "keywords",
        content:
          "demo,demosence,mod,xm,mod player,tracker,playlist,music,player,online music player,streaming,playlist management,audio player,web player,music streaming,play music online",
      },
    ],
    link: [
      { rel: "stylesheet", href: "/css/app.css" },
      { rel: "icon", href: "/images/favicon.png" },
    ],
  };
}
