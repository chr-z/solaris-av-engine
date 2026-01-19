import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  trigger: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  contentClassName?: string;
}

const Popover: React.FC<PopoverProps> = ({ trigger, children, contentClassName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const closePopover = useCallback(() => setIsOpen(false), []);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const contentWidth = 400; 
    const viewportWidth = window.innerWidth;
    const margin = 8;

    const newStyle: React.CSSProperties = {
      position: 'fixed',
      top: `${triggerRect.bottom + 4}px`,
      zIndex: 50,
    };

    if (triggerRect.left + contentWidth > viewportWidth - margin) {
        newStyle.right = `${viewportWidth - triggerRect.right}px`;
    } else {
        newStyle.left = `${triggerRect.left}px`;
    }

    setStyle(newStyle);
  }, []);
  
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
        calculatePosition();
    }
    setIsOpen(prev => !prev);
  }, [isOpen, calculatePosition]);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      isOpen &&
      triggerRef.current &&
      !triggerRef.current.contains(event.target as Node) &&
      contentRef.current &&
      !contentRef.current.contains(event.target as Node)
    ) {
      closePopover();
    }
  }, [isOpen, closePopover]);

  useEffect(() => {
    if (isOpen) {
        window.addEventListener('resize', calculatePosition);
    }
    return () => {
      window.removeEventListener('resize', calculatePosition);
    }
  }, [isOpen, calculatePosition]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', closePopover);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', closePopover);
    };
  }, [handleClickOutside, closePopover]);

  const triggerWithProps = React.cloneElement(trigger, {
    onClick: handleToggle,
    'aria-haspopup': true,
    'aria-expanded': isOpen,
  });

  return (
    <div ref={triggerRef}>
      {triggerWithProps}
      {isOpen && createPortal(
        <div 
          ref={contentRef}
          style={style}
          className={`bg-solar-light-content/80 dark:bg-solar-dark-content/80 backdrop-blur-md rounded-lg shadow-lg border border-solar-light-border dark:border-solar-dark-border p-1 ${contentClassName || ''}`}
          role="dialog"
          onClick={(e) => e.stopPropagation()}
        >
          {typeof children === 'function' ? children(closePopover) : children}
        </div>,
        document.body
      )}
    </div>
  );
};

export default Popover;