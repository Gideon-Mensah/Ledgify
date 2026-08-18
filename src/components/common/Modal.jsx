import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

// Renders the modal component.
function Modal({
  isOpen,
  title,
  description,
  children,
  footer,
  onClose,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef(null);

  // Keeps this part of the page in sync when its inputs change.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    // Handles key down.
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previouslyFocusedElement = document.activeElement;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus?.();
    };
  }, [isOpen, onClose]);

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
            ref={closeButtonRef}
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
