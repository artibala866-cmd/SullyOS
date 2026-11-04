import React from 'react';
import { createRoot } from 'react-dom/client';
import BootSequence from '../../components/os/BootSequence';

const root = document.getElementById('root');
if (!root) throw new Error('Missing branding test root');
const variant = new URLSearchParams(location.search).get('cover');
const classic = variant === 'classic';

createRoot(root).render(
  <BootSequence dataReady={false} style={classic ? 'classic' : 'jellyfish'}
    wallpaper="linear-gradient(135deg,#202037,#5f426e)" onDone={() => {}} />,
);

// Inspect the real React cover. Do not accept screenshots of an unloaded logo,
// missing title, clipped illustration or a replaced/AI-generated placeholder.
const inspect = (attempt = 0) => {
  const dog = document.querySelector<HTMLElement>('.sully-boot-art');
  const title = document.querySelector<HTMLElement>('.sully-boot-dog-wordmark');
  if ((!dog || !title) && attempt < 40) {
    setTimeout(() => inspect(attempt + 1), 100);
    return;
  }
  const boot = document.querySelector<HTMLElement>('.sully-boot');
  const bounds = dog?.getBoundingClientRect();
  const dogMotion = document.querySelector<HTMLElement>('.sully-boot-dog');
  const checks = {
    whiteBackground: !!boot && getComputedStyle(boot).backgroundColor === 'rgb(255, 255, 255)',
    whiteDog: !!document.querySelector('.sully-dog-body') && getComputedStyle(document.querySelector('.sully-dog-body')!).backgroundColor === 'rgb(255, 255, 255)',
    dogReasonableSize: !!bounds && bounds.width <= 230 && bounds.height <= 280 && bounds.left >= -2 && bounds.right <= innerWidth + 2,
    independentAnimation: !!dogMotion && getComputedStyle(dogMotion).animationName.includes('sullyPuppyDance') && !!document.querySelector('.sully-dog-ear.left'),
    titleSmallAndBottom: !!title && parseFloat(getComputedStyle(title).fontSize) <= 25 && title.getBoundingClientRect().top > innerHeight * .72,
    noDecorations: !document.querySelector('.sully-boot-eyebrow, .sully-boot-sparkle, .sully-boot-ornament'),
    correctCoverVariant: boot?.getAttribute('data-variant') === (classic ? 'night' : 'warm'),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    oldBrandNotVisible: !document.body.innerText.includes('糯米机'),
  };
  const output = document.createElement('output');
  output.id = 'baby-dog-qa-checks';
  output.textContent = JSON.stringify(checks);
  document.body.appendChild(output);
  output.style.cssText = 'display:none';
  document.body.dataset.babyDogQaReady = Object.values(checks).every(Boolean) ? 'true' : 'false';
};
setTimeout(() => inspect(), 150);
