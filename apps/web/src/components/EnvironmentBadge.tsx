import type { Environment } from '../api';
import { Badge } from '../ui';

// Larger than a Malphas md badge on purpose: the environment must never be missed.
const LOUD = 'px-3 py-1.5 text-sm';

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  return environment === 'producao' ? (
    <Badge variant="danger" className={LOUD}>
      PRODUÇÃO
    </Badge>
  ) : (
    <Badge variant="warning" className={LOUD}>
      PRODUÇÃO RESTRITA (teste)
    </Badge>
  );
}
