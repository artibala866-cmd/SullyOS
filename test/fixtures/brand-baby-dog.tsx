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
  const image = document.querySelector<HTMLImageElement>('img.sully-boot-dog');
  if ((!image || !image.complete) && attempt < 45) {
    setTimeout(() => inspect(attempt + 1), 100);
    return;
  }
  const title = document.querySelector<HTMLElement>('.sully-boot-dog-wordmark');
  const bounds = image?.getBoundingClientRect();
  const checks = {
    originalDogImageLoaded: !!image?.complete && (image?.naturalWidth ?? 0) >= 192,
    dogNotClipped: !!bounds && bounds.width > 90 && bounds.left >= -2 && bounds.right <= innerWidth + 2,
    dogTitleVisible: !!title && title.getBoundingClientRect().width > 30,
    correctCoverVariant: document.querySelector('.sully-boot')?.getAttribute('data-variant') === (classic ? 'night' : 'warm'),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    oldBrandNotVisible: !document.body.innerText.includes('糯米机'),
    oldSullyWordmarkNotVisible: !document.body.innerText.includes('SullyOS'),
  };
  const output = document.createElement('output');
  output.id = 'baby-dog-qa-checks';
  output.textContent = JSON.stringify(checks);
  document.body.appendChild(output);
  output.style.cssText = 'display:none';
  document.body.dataset.babyDogQaReady = Object.values(checks).every(Boolean) ? 'true' : 'false';
};
setTimeout(() => inspect(), 150);
