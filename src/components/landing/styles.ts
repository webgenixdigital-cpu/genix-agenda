// Classes compartilhadas da landing (ficam em src/components: o Tailwind só lê esta pasta, não src/lib).

/** largura do conteúdo: 1120 px, gutter 16 px no celular e 32 px a partir do md */
export const lpWrap = "mx-auto w-full max-w-[1120px] px-4 md:px-8";

/** respiro das seções: 64 px no celular, 96 px a partir do md */
export const lpSection = "py-16 md:py-24";

/** botão pílula (52 px de altura) */
export const lpBtn =
  "inline-flex h-[52px] items-center justify-center gap-2 whitespace-nowrap rounded-full px-7 font-bold transition-[background-color,color,transform] duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
export const lpBtnSolid = `${lpBtn} bg-primary text-primary-foreground hover:bg-[#7a4420]`;
export const lpBtnOutline = `${lpBtn} text-primary shadow-[inset_0_0_0_2px_hsl(var(--primary))] hover:bg-primary hover:text-primary-foreground`;
export const lpBtnGold = `${lpBtn} bg-[#F2C078] text-foreground hover:bg-[#ebb066]`;

/** card branco alinhado à esquerda */
export const lpCard = "rounded-[20px] border bg-card p-6 text-left md:p-8";

/** rótulo pequeno em caixa alta acima dos títulos de seção */
export const lpKicker = "mb-4 inline-block text-xs font-bold uppercase tracking-[0.14em] text-primary";

/** título de seção (centralizado) */
export const lpHeadTitle = "text-[length:clamp(30px,4.2vw,44px)] font-bold leading-[1.15]";
