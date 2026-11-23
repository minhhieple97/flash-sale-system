export interface StateGaugeInput {
  readonly name: string;
  readonly help: string;
  readonly states: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function renderStateGauge({ name, help, states, counts }: StateGaugeInput): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  for (const state of states) {
    lines.push(`${name}{state="${state}"} ${counts[state] ?? 0}`);
  }
  return lines;
}
