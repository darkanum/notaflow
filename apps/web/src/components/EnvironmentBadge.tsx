import type { Environment } from '../api';
import { Badge } from '../ui';
import { showsEnvironment, useMe } from './MeContext';

// Larger than a Malphas md badge on purpose: the environment must never be missed.
const LOUD = 'self-start px-3 py-1.5 text-sm';

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  const me = useMe();
  if (!showsEnvironment(me, environment)) return null;
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
