/* Momotamu display form and the Stage (pure; no DOM).
   When the Stage opens (a guest joins the conversation) while Momotamu is shown as Presence or Portrait, she switches to
   Character and the earlier form is remembered under duo-voice-momotamu-form-before-stage. A choice the user makes
   while the Stage is open is kept for the rest of that Stage. When the Stage closes, the earlier form comes back only if
   the switch was automatic and the user did not choose again; the remembered value is cleared either way.
   update() is called with every observed Stage state; it returns the form to show. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionMomotamuFormRule = api;
})(globalThis, function () {
  'use strict';
  const FORMS = Object.freeze(['character', 'presence', 'portrait']);
  const BEFORE_STAGE = 'duo-voice-momotamu-form-before-stage';
  const valid = value => FORMS.includes(value);
  function create({ storage } = {}) {
    const get = () => { try { return storage?.getItem(BEFORE_STAGE) ?? null; } catch { return null; } };
    const set = value => { try { storage?.setItem(BEFORE_STAGE, value); } catch { /* remembered for this run only */ } };
    const clear = () => { try { storage?.removeItem(BEFORE_STAGE); } catch { /* nothing to clear */ } };
    let open = null, auto = false, manual = false, memory = null;   // open: null until the first observation
    const before = () => { const stored = get(); return valid(stored) ? stored : memory; };
    function update(stageOpen, form) {
      stageOpen = !!stageOpen; form = valid(form) ? form : 'character';
      if (stageOpen === open) return form;
      const first = open === null; open = stageOpen;
      if (stageOpen) {
        manual = false;
        if (form !== 'character') { memory = form; set(form); auto = true; return 'character'; }
        // Character already: an earlier run may have switched automatically and quit during the Stage; that switch still counts.
        auto = first && valid(get()); if (!auto) { memory = null; clear(); }
        return form;
      }
      // Closed. On the first observation a remembered form means the app quit during an automatic switch: the Stage is over.
      const previous = before(), restore = (first || (auto && !manual)) && valid(previous);
      clear(); memory = null; auto = false; manual = false;
      return restore ? previous : form;
    }
    // The user chose a form in View or Settings. During a Stage that choice wins for the rest of the Stage.
    function choose(form) {
      if (open !== true) return valid(form) ? form : 'character';
      manual = true; auto = false; memory = null; clear();
      return valid(form) ? form : 'character';
    }
    return { update, choose, snapshot: () => ({ open, auto, manual, before: before() }) };
  }
  return Object.freeze({ create, FORMS, BEFORE_STAGE });
});
