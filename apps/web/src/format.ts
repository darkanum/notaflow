const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

// Timestamps arrive in UTC; the day that matters to the user is the Brasília day.
const brasiliaDay = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDate(value: string | null): string {
  if (!value) return '';
  return brasiliaDay.format(new Date(value));
}

export function formatCompetence(value: string): string {
  const [year, month] = value.split('-');
  return `${month}/${year}`;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
