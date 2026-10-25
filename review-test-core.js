/* Pure scoring rules, shared by the browser and the dataset regression checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingTestCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  function normalize(value, policy = {}, extensions = {}) {
    let text = String(value ?? '');
    if (policy.unicode) text = text.normalize(policy.unicode);
    if (policy.apostrophePolicy === 'equivalent') text = text.replace(/[‘’ʼ＇]/g, "'");
    if (policy.hyphenPolicy === 'equivalent') text = text.replace(/[-‐‑‒–—−]/g, ' ');
    if (policy.trim !== false) text = text.trim();
    if (extensions.quotePolicy === 'blockbuster-museology-outer-quotes-v1') text = text.replace(/^['"“”]+|['"“”]+$/g, '').trim();
    if (policy.collapseWhitespace !== false) text = text.replace(/\s+/g, ' ');
    if (!policy.caseSensitive) text = text.toLocaleLowerCase('en');
    return text;
  }
  function textMatch(value, accepted, policy, extensions) {
    const actual = normalize(value, policy, extensions);
    return !!actual && accepted.some(a => a.kind === 'text' && normalize(a.value, policy, extensions) === actual);
  }
  function gradeGroup(group, snapshot) {
    const responses = snapshot.responses || {}, sets = snapshot.sets || {};
    const values = group.responses.map(id => String(responses[id] || ''));
    const total = group.scores.reduce((sum, s) => sum + s.marks, 0);
    let earned = 0, answered = values.some(v => v.trim()), note = '';
    if (group.evaluation === 'unordered-membership') {
      const selected = [...new Set(sets[group.id] || [])];
      answered = selected.length > 0;
      if (selected.length <= group.maxSelections) {
        for (const s of group.scores) if (s.accepted.some(a => selected.includes(a.value))) earned += s.marks;
      } else note = '所选项数超过本题上限。';
    } else if (group.evaluation === 'atomic-unordered-text-set') {
      const s = group.scores[0], members = new Map();
      for (const a of s.accepted) {
        const id = a.setMemberId || a.value;
        if (!members.has(id)) members.set(id, []);
        members.get(id).push(a);
      }
      const accepted = [...members.values()];
      // Backtracking permits aliases but never awards the same member twice.
      const match = (index, used) => index === values.length ? used.size === accepted.length :
        accepted.some((a, j) => !used.has(j) && textMatch(values[index], a, s.normalization, s.extensions) && match(index + 1, new Set([...used, j])));
      if (values.length === accepted.length && match(0, new Set())) earned = total;
      if (values.length > 1) note = '按原题绑定题规则：两空顺序不限，需分别填出两个不同答案，整组正确才得分。';
    } else {
      for (const s of group.scores) {
        const value = String(responses[s.responses[0]] || '');
        const correct = group.evaluation === 'exact-option' ? s.accepted.some(a => a.value === value) : textMatch(value, s.accepted, s.normalization, s.extensions);
        if (correct) earned += s.marks;
      }
    }
    return {earned, total, answered, note, status:earned === total ? 'correct' : earned ? 'partial' : answered ? 'incorrect' : 'unanswered'};
  }
  function grade(groups, snapshot) {
    const results = Object.fromEntries(groups.map(g => [g.id, gradeGroup(g, snapshot)]));
    return {results, earned:Object.values(results).reduce((n,r)=>n+r.earned,0), total:Object.values(results).reduce((n,r)=>n+r.total,0)};
  }
  return {normalize, textMatch, gradeGroup, grade};
});
