import React, { useState, useRef, useCallback, cloneElement, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, className }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const pinTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});
  const [isFlipped, setIsFlipped] = useState(false);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;
    
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const margin = 10;
    
    let top: number;
    let left: number;
    let flipped = false;

    // Vertical positioning: Prefer top, flip to bottom if constrained
    if (triggerRect.top > tooltipRect.height + margin) {
      top = triggerRect.top - tooltipRect.height - margin;
    } else {
      top = triggerRect.bottom + margin;
      flipped = true;
    }

    // Horizontal positioning: Center align
    left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);

    // Viewport constraints
    if (left < margin) {
      left = margin;
    } else if (left + tooltipRect.width > window.innerWidth - margin) {
      left = window.innerWidth - tooltipRect.width - margin;
    }
    
    if (flipped && top + tooltipRect.height > window.innerHeight - margin) {
        top = window.innerHeight - tooltipRect.height - margin;
    }
    
    setIsFlipped(flipped);
    setStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      zIndex: 10000,
    });

    // Arrow positioning
    const arrowLeft = triggerRect.left + (triggerRect.width / 2) - left;
    setArrowStyle({
      left: `${arrowLeft}px`
    });
  }, []);

  useLayoutEffect(() => {
    if (isVisible) {
      calculatePosition();
      window.addEventListener('resize', calculatePosition);
      window.addEventListener('scroll', calculatePosition, true);
    }
    return () => {
      window.removeEventListener('resize', calculatePosition);
      window.removeEventListener('scroll', calculatePosition, true);
    };
  }, [isVisible, calculatePosition]);


  const clearTimers = useCallback(() => {
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setIsPinned(false);
  }, []);
  
  const startCloseTimer = useCallback(() => {
    clearTimers();
    closeTimerRef.current = window.setTimeout(handleClose, 250);
  }, [clearTimers, handleClose]);

  const handleMouseEnterTrigger = useCallback(() => {
    clearTimers();
    setIsVisible(true);
    pinTimerRef.current = window.setTimeout(() => setIsPinned(true), 500);
  }, [clearTimers]);

  const handleMouseLeaveTrigger = useCallback(() => {
    if (!isPinned) {
        clearTimers();
        handleClose();
    } else {
        startCloseTimer();
    }
  }, [isPinned, clearTimers, startCloseTimer, handleClose]);

  const handleMouseEnterTooltip = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  const handleMouseLeaveTooltip = useCallback(() => {
    startCloseTimer();
  }, [startCloseTimer]);

  const triggerWithHandlers = cloneElement(children as React.ReactElement<any>, {
    onMouseEnter: handleMouseEnterTrigger,
    onMouseLeave: handleMouseLeaveTrigger,
    onFocus: handleMouseEnterTrigger,
    onBlur: handleMouseLeaveTrigger,
  });

  return (
    <div ref={triggerRef} className="inline-flex items-center">
      {triggerWithHandlers}
      {isVisible && createPortal(
        <div
          ref={tooltipRef}
          style={style}
          onMouseEnter={handleMouseEnterTooltip}
          onMouseLeave={handleMouseLeaveTooltip}
          role="tooltip"
          className={`w-72 rounded-lg border border-solar-dark-border bg-solar-dark-bg/95 backdrop-blur-sm 
                    p-3 text-sm text-gray-300 shadow-xl animate-fade-in-fast
                    ${className}`}
        >
          {content}
          <div 
            style={arrowStyle}
            className={`absolute h-0 w-0 -translate-x-1/2 border-x-8 border-x-transparent
              ${isFlipped 
                ? 'top-[-8px] border-b-8 border-b-solar-dark-bg' 
                : 'bottom-[-8px] border-t-8 border-t-solar-dark-bg'
              }`}
          ></div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Tooltip;