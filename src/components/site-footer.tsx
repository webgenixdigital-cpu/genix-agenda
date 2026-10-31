import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export function SiteFooter() {
  return (
    <footer className="border-t py-10 text-center text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 md:px-6">
        <p>{LEGAL.produto}, um produto {LEGAL.nomeFantasia}</p>
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Links institucionais">
          <Link href="/" className="hover:text-foreground" data-testid="link-rodape-profissionais">Para profissionais</Link>
          <Link href="/espacos" className="hover:text-foreground" data-testid="link-rodape-espacos">Encontrar um espaço</Link>
          <Link href="/termos" className="hover:text-foreground" data-testid="link-rodape-termos">Termos de Uso</Link>
          <Link href="/privacidade" className="hover:text-foreground" data-testid="link-rodape-privacidade">Privacidade</Link>
          <a href={`mailto:${LEGAL.emailContato}`} className="hover:text-foreground">Contato</a>
        </nav>
      </div>
    </footer>
  );
}
