"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button className="h-11" onClick={() => window.print()} data-testid="btn-imprimir">
      <Printer className="mr-1.5 h-4 w-4" /> Imprimir ou salvar em PDF
    </Button>
  );
}
