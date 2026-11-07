import { LANDING_PHONE } from "@/content/landing";

const pillBase = "whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold";
const pillOk = `${pillBase} bg-[#e4f4ea] text-[#2f7a4b]`;
const pillWait = `${pillBase} bg-[#fdf1df] text-[#8a5a14]`;

/**
 * Ilustração do hero: a agenda se monta, chega o lembrete do WhatsApp, o cliente responde "1"
 * e o último horário vira Confirmado. Só CSS (globals.css: lp-rise, lp-float, lp-status-*).
 */
export function PhoneMock() {
  const p = LANDING_PHONE;
  const last = p.slots.length - 1;

  return (
    <div className="relative flex justify-center" aria-hidden>
      {/* brilho dourado atrás do aparelho */}
      <div className="absolute inset-x-[6%] inset-y-[8%] bg-[radial-gradient(circle_at_50%_40%,rgba(242,192,120,0.5),transparent_65%)] blur-[30px]" />

      <div className="relative w-[min(340px,calc(100%-20px))] rounded-[40px] bg-white px-4 py-6 text-left shadow-[0_0_0_10px_#1c1917,0_40px_80px_-30px_rgba(28,25,23,0.5)]">
        <div className="mb-4 flex justify-between text-[13px] text-muted-foreground">
          <strong className="text-[15px] text-foreground">{p.day}</strong>
          <span>{p.count}</span>
        </div>

        {p.slots.map((s, i) => (
          <div
            key={s.time}
            className="lp-rise mb-2 flex items-center justify-between gap-2 rounded-[14px] bg-background px-3.5 py-3 text-sm"
            style={{ animationDelay: `${0.3 + i * 0.3}s` }}
          >
            <span className="min-w-0">
              {s.time} · {s.service}
              <small className="block text-xs text-muted-foreground">{s.customer}</small>
            </span>
            {i === last ? (
              <span className="grid shrink-0 justify-items-end">
                <span className={`lp-status-old col-start-1 row-start-1 ${pillWait}`}>{p.pending}</span>
                <span className={`lp-status-new col-start-1 row-start-1 ${pillOk}`}>{p.confirmed}</span>
              </span>
            ) : (
              <span className={`shrink-0 ${pillOk}`}>{p.confirmed}</span>
            )}
          </div>
        ))}

        <div className="lp-rise mt-4 rounded-[16px_16px_16px_4px] bg-[#e7f6ec] px-3.5 py-3 text-[13px]" style={{ animationDelay: "1.6s" }}>
          <b className="mb-0.5 block text-[11px] text-[#2f7a4b]">{p.reminderLabel}</b>
          {p.reminderText}
        </div>
        <div className="lp-rise ml-auto mt-2 w-max rounded-[16px_16px_4px_16px] bg-[#dcf8c6] px-3.5 py-2 text-[13px]" style={{ animationDelay: "3.4s" }}>
          {p.reply}
        </div>
      </div>

      {/* cards flutuantes: somem abaixo de 600 px */}
      {p.floats.map((f, i) => (
        <div
          key={f.label}
          className={`lp-float absolute hidden max-w-[180px] rounded-2xl bg-white px-4 py-3 text-[13px] shadow-[0_20px_40px_-18px_rgba(28,25,23,0.35)] min-[600px]:block ${
            i === 0 ? "left-[-4%] top-[18%]" : "bottom-[14%] right-[-4%]"
          }`}
          style={{ animationDelay: i === 0 ? "2s, 2.6s" : "2.4s, 3s" }}
        >
          <b className="block font-heading text-xl text-primary">{f.value}</b>
          {f.label}
        </div>
      ))}
    </div>
  );
}
