/* Aladí Library Portal — JS */

// Auto-dismiss flash messages after 5 seconds
document.addEventListener('DOMContentLoaded', () => {
  const flashes = document.querySelectorAll('.flash');
  flashes.forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 5000);
  });
});
