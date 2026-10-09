// "DPS" + cMun(7) + tpInsc(2 = CNPJ) + CNPJ(14) + series(5) + number(15) = 45 characters.
export function buildDpsId(input: {
  municipality: string;
  cnpj: string;
  series: string;
  number: number;
}): string {
  const series = input.series.padStart(5, '0');
  const id = `DPS${input.municipality}2${input.cnpj}${series}${String(input.number).padStart(15, '0')}`;
  if (!/^DPS[0-9]{7}2[0-9A-Z]{14}[0-9]{20}$/.test(id))
    throw new RangeError(`Invalid DPS id: ${id}`);
  return id;
}
