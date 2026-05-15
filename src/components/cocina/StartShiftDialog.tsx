import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChefHat, Play } from 'lucide-react';

interface Props {
  open: boolean;
  onStart: () => void;
}

/**
 * Diálogo modal obligatorio que se muestra al entrar al KDS.
 *
 * Cumple dos propósitos:
 *  1. Acto de inicio de turno explícito (estándar en KDS profesionales como
 *     Toast, Square, Lightspeed).
 *  2. Captura el "gesto del usuario" requerido por los navegadores para
 *     desbloquear `AudioContext`. Sin este gesto, las alertas sonoras nunca
 *     podrían reproducirse en Chrome/Safari/Edge.
 *
 * El diálogo no se puede cerrar con ESC ni clic fuera: el operario debe
 * pulsar el botón para garantizar el desbloqueo del audio.
 */
export function StartShiftDialog({ open, onStart }: Props) {
  return (
    <Dialog open={open} onOpenChange={() => { /* no-op: modal obligatorio */ }}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="items-center text-center space-y-4 pt-2">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
            <ChefHat className="h-8 w-8 text-primary-foreground" />
          </div>
          <DialogTitle className="text-2xl">Iniciar turno de cocina</DialogTitle>
          <DialogDescription className="text-base">
            Pulsa el botón para activar las alertas sonoras y comenzar a recibir
            órdenes en tiempo real.
          </DialogDescription>
        </DialogHeader>
        <div className="pt-4 pb-2">
          <Button
            onClick={onStart}
            size="lg"
            className="w-full h-14 text-base gap-2"
            autoFocus
          >
            <Play className="h-5 w-5" />
            Iniciar turno
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
