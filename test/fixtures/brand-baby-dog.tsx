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

// 真实组件检查：必须取自原图线稿，不接受旧 CSS 代画或放大的色彩图。
const inspect = (attempt = 0) => {
  const dog = document.querySelector<HTMLElement>('.sully-lineart');
  const canvas = document.querySelector<HTMLCanvasElement>('.sully-lineart-canvas');
  const label = document.querySelector<HTMLElement>('.sully-boot-side-label');
  const caption = document.querySelector<HTMLElement>('.sully-boot-welcome');
  if ((!dog || !canvas || dog.dataset.lineReady !== 'true') && attempt < 55) {
    setTimeout(() => inspect(attempt + 1), 100);
    return;
  }
  const boot = document.querySelector<HTMLElement>('.sully-boot');
  const rect = dog?.getBoundingClientRect();
  const pixels = canvas?.getContext('2d')?.getImageData(0, 0, 512, 512).data;
  const nonEmpty = pixels ? Array.from({length: 512}, (_, i) => pixels[(180 * 512 + i) * 4 + 3]).some(alpha => alpha > 50) : false;
  const checks = {
    whiteBackground: !!boot && getComputedStyle(boot).backgroundColor === 'rgb(255, 255, 255)',
    originalLineartLoaded: dog?.dataset.lineReady === 'true' && nonEmpty,
    artworkSmall: !!rect && rect.width <= Math.min(innerWidth * .75, 250) && rect.right < innerWidth && rect.left > 0,
    noFabricatedDog: !document.querySelector('.sully-dog-body, .sully-dog-ear, .sully-dog-tail'),
    growing: !!dog && getComputedStyle(dog).animationName.includes('sullyLineGrow'),
    blinking: !!document.querySelector('.sully-lineart-eyes-closed') &&
      getComputedStyle(document.querySelector('.sully-lineart-eyes-closed')!).animationName.includes('sullyLineEyesClosed'),
    speaking: !!document.querySelector('.sully-lineart-mouth-talking'),
    dogLabel: label?.textContent === 'dog',
    englishWelcome: caption?.textContent === 'Welcome home.',
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
