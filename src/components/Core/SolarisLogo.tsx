import React, { useState, useEffect } from 'react';

// Logo Solaris v3: disco com gradiente accent refinado + halo.
// Animação de entrada toca UMA vez por sessão (momento wow nº 1 da spec),
// respeita prefers-reduced-motion (tokens.css zera animations globalmente).
// A marcação de "já tocou" acontece em effect — nunca durante o render.
let introPlayedThisSession = false;

interface SolarisLogoProps {
  size?: number; // px
  className?: string;
  /** Força a animação de intro (ex.: tela de login) */
  alwaysAnimate?: boolean;
}

const SolarisLogo: React.FC<SolarisLogoProps> = ({
  size = 24,
  className = '',
  alwaysAnimate = false,
}) => {
  // lazy initializer: decide UMA vez por instância, lendo (sem escrever) a flag
  const [animate] = useState(() => alwaysAnimate || !introPlayedThisSession);

  useEffect(() => {
    introPlayedThisSession = true;
  }, []);

  return (
    <span
      className={`solaris-logo ${animate ? 'solaris-logo-intro' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="solaris-logo-disc" />
    </span>
  );
};

export default SolarisLogo;
