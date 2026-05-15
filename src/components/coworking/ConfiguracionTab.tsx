import { TarifasConfig } from './TarifasConfig';
import type { Area } from './types';

interface Props {
  areas: Area[];
}

export function ConfiguracionTab({ areas }: Props) {
  return <TarifasConfig areas={areas} />;
}
