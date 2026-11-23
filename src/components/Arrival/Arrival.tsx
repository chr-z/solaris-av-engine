import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { GoogleIcon } from '../Core/icons';
import SolarisLogo from '../Core/SolarisLogo';
import { humanizeAuthError } from '../../utils/humanErrors';
import ArrivalStage from './ArrivalStage';
import { tourCopy } from './copy';
import './arrival.css';

interface ArrivalProps {
  onLogin: () => void;
  onGuestLogin?: () => void;
  /** Leaves the tour without signing in — straight to the compact sign-in. */
  onSkip: () => void;
  isLoading: boolean;
  error: string | null;
}

const Arrival: React.FC<ArrivalProps> = ({ onLogin, onGuestLogin, onSkip, isLoading, error }) => {
  const { locale, setLocale } = useI18n();
  const copy = tourCopy[locale === 'pt' ? 'pt' : 'en'];
  const steps = copy.steps;
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  // Active chapter follows the scroll position, not a timer.
  useEffect(() => {
    const nodes = refs.current.filter(Boolean) as HTMLElement[];
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const idx = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isNaN(idx)) setActive(idx);
        });
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [steps.length]);

  const goTo = useCallback((idx: number) => {
    refs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const last = steps.length - 1;
  const stats = useMemo(() => copy.stats, [copy]);

  return (
    <div className="arrival">
      <header className="arrival__top">
        <a className="arrival__brand" href="https://chr-z.dev/" aria-label="Solaris by chr-z">
          <SolarisLogo size={20} />
          <span className="arrival__wordmark">Solaris</span>
          <span className="arrival__by">by chr-z</span>
        </a>

        <nav className="rail" aria-label="Tour chapters">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="rail__seg"
              data-on={i <= active}
              data-current={i === active}
              onClick={() => goTo(i)}
              aria-label={`${s.eyebrow} — ${s.title}`}
              aria-current={i === active ? 'step' : undefined}
            >
              <span className="rail__num tnum">{String(i + 1).padStart(2, '0')}</span>
            </button>
          ))}
        </nav>

        <div className="arrival__actions">
          <div className="lang" role="group" aria-label="Language">
            <button type="button" data-on={locale !== 'pt'} onClick={() => setLocale('en')} lang="en">
              EN
            </button>
            <button type="button" data-on={locale === 'pt'} onClick={() => setLocale('pt')} lang="pt-BR">
              PT
            </button>
          </div>
          <button type="button" className="skipbtn" onClick={onSkip} title={copy.skipHint}>
            {copy.skip} <span aria-hidden="true">→</span>
          </button>
        </div>
      </header>

      <div className="arrival__main">
        <div className="arrival__copy">
          <span className="arrival__counter tnum" aria-live="polite">
            {String(active + 1).padStart(2, '0')} <span>{copy.stepWord}</span> {String(steps.length).padStart(2, '0')}
          </span>

          {steps.map((step, i) => (
            <section
              key={step.id}
              className="step"
              data-index={i}
              data-active={i === active}
              ref={(el) => {
                refs.current[i] = el;
              }}
              aria-labelledby={`step-${step.id}`}
            >
              <p className="step__eyebrow">{step.eyebrow}</p>
              <h2 className="step__title" id={`step-${step.id}`}>
                {step.title}
              </h2>
              <p className="step__body">{step.body}</p>

              <ul className="step__facts">
                {step.facts.map((f) => (
                  <li key={f} className="step__fact">
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {i === last && (
                <div className="cta" id="tour-cta">
                  <div className="cta__stats">
                    {stats.map((s) => (
                      <div key={s.label} className="cta__stat">
                        <strong className="tnum">{s.value}</strong>
                        <span>{s.label}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary cta__primary"
                    onClick={onLogin}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <span className="cta__spinner" aria-hidden="true" />
                    ) : (
                      <GoogleIcon className="w-5 h-5" />
                    )}
                    {copy.cta.google}
                  </button>

                  {onGuestLogin && (
                    <button type="button" className="btn btn-ghost cta__secondary" onClick={onGuestLogin} disabled={isLoading}>
                      {copy.cta.demo}
                    </button>
                  )}

                  <p className="cta__note">{copy.cta.note}</p>

                  {error &&
                    (() => {
                      const he = humanizeAuthError(error);
                      return (
                        <div className="cta__error" role="alert">
                          <strong>{he.title}</strong>
                          <span>{he.hint}</span>
                        </div>
                      );
                    })()}
                </div>
              )}
            </section>
          ))}

          <footer className="arrival__foot">
            <span className="tnum">© {new Date().getFullYear()} chr-z</span>
            <span aria-hidden="true">·</span>
            <a href="https://chr-z.dev/">chr-z.dev</a>
            <span aria-hidden="true">·</span>
            <span>{copy.stats[0].value} {copy.stats[0].label}</span>
          </footer>
        </div>

        <aside className="arrival__stage" aria-label={copy.tapeLabel}>
          <ArrivalStage copy={copy} step={steps[active]} index={active} />
        </aside>
      </div>
    </div>
  );
};

export default Arrival;
