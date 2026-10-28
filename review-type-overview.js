/* Reuse the existing question navigation, including recall and wrong-only modes. */
document.querySelector('.article-question-types')?.addEventListener('click',event=>{
  const target=event.target.closest('button[data-type-question]');
  if(!target)return;
  const nav=[...document.querySelectorAll('.question-nav button[data-question]')].find(button=>button.dataset.question===target.dataset.typeQuestion);
  nav?.click();
});
