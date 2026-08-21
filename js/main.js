document.getElementById('hamburger').addEventListener('click', ()=>{
  document.getElementById('mobileMenu').classList.toggle('open');
});
document.querySelectorAll('.mobile-menu a').forEach(a=>{
  a.addEventListener('click', ()=> document.getElementById('mobileMenu').classList.remove('open'));
});

const root = document.documentElement;
document.getElementById('themeToggle').addEventListener('click', ()=>{
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('vista_theme', next);
});

function runReveal(){
  const els = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver(entries=>{
    entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} });
  },{threshold:.15});
  els.forEach(el=>io.observe(el));
}
runReveal();

const counters = document.querySelectorAll('.stat[data-count]');
const cio = new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      const el = e.target, target = +el.dataset.count;
      let cur = 0; const step = Math.max(1, Math.round(target/60));
      const t = setInterval(()=>{ cur += step; if(cur>=target){cur=target; clearInterval(t);} el.textContent = cur+'+'; },20);
      cio.unobserve(el);
    }
  });
},{threshold:.4});
counters.forEach(c=>cio.observe(c));

(function(){
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const closeBtn = document.getElementById('lightboxClose');
  if(!lightbox) return;

  function bigVersion(src){
    return src.replace(/\/(\d+)\/(\d+)(\?.*)?$/, '/1600/1600$3');
  }
  function openLightbox(img){
    lightboxImg.src = bigVersion(img.src);
    lightboxImg.alt = img.alt || '';
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox(){
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    lightboxImg.src = '';
  }
  document.querySelectorAll('.photo-row a').forEach(a=>{
    a.addEventListener('click', e=>{
      e.preventDefault();
      const img = a.querySelector('img');
      if(img) openLightbox(img);
    });
  });
  closeBtn.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e=>{ if(e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeLightbox(); });
})();

(function(){
  const logo = document.getElementById('heroLogo');
  const blobsWrap = document.getElementById('heroBlobs');
  const hero = document.querySelector('.hero');
  if(!hero) return;
  window.addEventListener('scroll', ()=>{
    const y = window.scrollY;
    const heroH = hero.offsetHeight;
    if(y < heroH){
      const progress = y / heroH;
      if(logo) logo.style.transform = `translateY(${y*0.25}px) scale(${1 - progress*0.06})`;
      if(blobsWrap) blobsWrap.style.transform = `translateY(${y*0.15}px)`;
      hero.style.opacity = 1 - progress*0.6;
    }
  }, {passive:true});
})();
