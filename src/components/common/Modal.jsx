import { useEffect, useEffectEvent, useId, useRef } from "react";
import { X } from "lucide-react";

const openDialogs = [];
let previousBodyOverflow = '';
const focusableElements = dialog => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
  .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length && !element.closest('[inert]'));

// Shared focus lifetime follows opening/closing, not callback identity.
function Modal({
  isOpen,
  title,
  description,
  children,
  footer,
  onClose,
  initialFocusRef,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const close = useEffectEvent(() => onClose());
  const focusInitial = useEffectEvent(() => {
    const dialog = dialogRef.current;
    const fields = focusableElements(dialog);
    const preferred = initialFocusRef?.current;
    (fields.includes(preferred) ? preferred : fields.find(element => !element.classList.contains('modal-close-button')) || fields[0] || dialog).focus();
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    const dialog = dialogRef.current;
    const previouslyFocusedElement = document.activeElement;
    if (!openDialogs.length) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(dialog);
    const handleKeyDown = event => {
      if (openDialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        const fields = focusableElements(dialog);
        const first = fields[0];
        const last = fields.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const frame = window.requestAnimationFrame(() => {
      if (openDialogs.at(-1) === dialog && !dialog.contains(document.activeElement)) focusInitial();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      const wasTop = openDialogs.at(-1) === dialog;
      const index = openDialogs.indexOf(dialog);
      if (index !== -1) openDialogs.splice(index, 1);
      if (!openDialogs.length) document.body.style.overflow = previousBodyOverflow;
      if (wasTop && previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={onClose}
    >
      <div
        className="modal-container"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>

            {description && <p id={descriptionId}>{description}</p>}
          </div>

          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {children}
        </div>

        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
