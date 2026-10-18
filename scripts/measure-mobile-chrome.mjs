// Measurements use actual DOM baselines and canvas glyph ink, not line boxes.
export function measureMobileChrome() {
  const box = n => { const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
  const ink = n => {
    const probe=document.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';n.append(probe);const baseline=probe.getBoundingClientRect().top;probe.remove();
    const s=getComputedStyle(n),c=document.createElement('canvas').getContext('2d');c.font=`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;const m=c.measureText(n.textContent);return {top:baseline-m.actualBoundingBoxAscent,bottom:baseline+m.actualBoundingBoxDescent};
  };
  const row = selector => { const n=document.querySelector(selector);if(!n)return null;const r=box(n),s=getComputedStyle(n);return {...r,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],border:[s.borderTopWidth,s.borderBottomWidth],controls:[...n.querySelectorAll('button')].map(b=>{const p=getComputedStyle(b,'::before'),r=box(b),inset=parseFloat(p.top)||0;return {...r,name:b.textContent.trim()||b.getAttribute('aria-label'),faceTop:r.y+inset,faceBottom:r.bottom-inset,faceHeight:r.height-2*inset};})}; };
  const mods=document.querySelector('[data-mobile-modifiers]'),wrap=mods.nextElementSibling;
  const groups=[document.querySelector('[data-mobile-panels-row]'),mods,wrap.firstElementChild].filter(Boolean);
  const gaps=groups.flatMap(group=>[...group.children].filter(n=>n.tagName==='BUTTON').slice(1).map(n=>box(n).x-box(n.previousElementSibling).right));
  return {gaps,seam:box(wrap).x-box(mods).right,panels:row('[data-mobile-panels-row]'),keys:row('[data-mobile-extra-keys]'),pinned:document.querySelector('[data-mobile-extra-keys]').dataset.modifiersPinned,
    tabs:[...document.querySelectorAll('[data-mobile-session-chip]')].map(n=>{const r=box(n),p=getComputedStyle(n,'::after'),line=n.querySelector('[data-mobile-session-secondary]')||n.querySelector('[data-mobile-session-primary]');const glyph=ink(line),underline=r.bottom-parseFloat(p.bottom)-parseFloat(p.height);return {...r,glyph,underline,gap:underline-glyph.bottom};})};
}
