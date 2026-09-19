import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, subtitle, onClose, children, wide = false, drawer = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = ref.current;
    const getFocusable = () => [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
    (dialog.querySelector('[data-autofocus]') || getFocusable()[0])?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = getFocusable(), first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = overflow; dialog.removeEventListener('keydown', handleKey); before?.focus(); };
  }, [onClose]);
  return <div className={`modal-backdrop ${drawer ? 'drawer-backdrop' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${drawer ? 'drawer' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <header className="modal-header"><div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={21}/></button></header>
      {children}
    </section>
  </div>;
}
