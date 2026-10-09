import type { Environment } from '../api';

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  return environment === 'producao' ? (
    <span className="badge badge-production">PRODUÇÃO</span>
  ) : (
    <span className="badge badge-test">PRODUÇÃO RESTRITA (teste)</span>
  );
}
