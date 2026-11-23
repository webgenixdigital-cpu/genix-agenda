"use client";

// Recursos do nicho do espaço (63/64). O banco é a fonte da verdade;
// aqui as telas só sabem o que mostrar.
import { createContext, useContext } from "react";

export type NicheFlags = {
  /** nicho "Banho e tosa": quem é atendido é o pet; o tutor é o cliente */
  petMode: boolean;
};

const NicheFlagsCtx = createContext<NicheFlags>({ petMode: false });

export function NicheFlagsProvider({ value, children }: { value: NicheFlags; children: React.ReactNode }) {
  return <NicheFlagsCtx.Provider value={value}>{children}</NicheFlagsCtx.Provider>;
}

export const useNicheFlags = () => useContext(NicheFlagsCtx);
