"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { brl } from "@/lib/format";

type Point = { label: string; entradas: number; saidas: number };

const compact = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${v}`;

export function RevenueChart({ data }: { data: Point[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E0D2" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} width={78} />
          <Tooltip
            formatter={(v) => brl(Number(v))}
            cursor={{ fill: "#F5EFE6" }}
            contentStyle={{ borderRadius: 12, borderColor: "#E7E0D2" }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="entradas" name="Entradas" fill="#99582A" radius={[6, 6, 0, 0]} />
          <Bar dataKey="saidas" name="Saídas" fill="#D6D3D1" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}