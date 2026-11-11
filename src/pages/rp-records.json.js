// The records this site holds, for the pickers.
//
// ⚠️ A RECORD PICKER IS TWO HALVES AND THE MARKUP IS ONLY ONE OF THEM. The
// container on /faq carries `data-rp-kind="ids" data-rp-record="faqs"`, and the
// editor answers that by fetching THIS endpoint and painting what it finds
// under that key. Ship the markup without the endpoint and the picker opens
// empty: the owner presses Questions and is offered nothing to choose. That
// happened on rp-launch on 2026-10-19 — the FAQ was mapped as records and this
// file was not written, so the mapping was correct and invisible.
//
// It reads the published content, so a question whose words have already been
// changed is offered in the words they were changed to.
import site from '../config/site.config.js';

export function GET() {
  const faqs = (site.faqs || []).map((f) => ({
    id: f.id,
    // What the picker shows: the question itself, with the start of the answer
    // underneath it, because two questions can open the same way.
    label: f.question,
    meta: (f.answer || '').replace(/\s+/g, ' ').slice(0, 90),
    tags: [f.category, ...(f.tags || [])].filter(Boolean),
  }));

  return new Response(JSON.stringify({
    // `askLabel` and `askLine` are what the picker says under "Not here?", and
    // they belong to the record TYPE: a question is a thing WE write the answer
    // to, so the line asks for the question rather than offering a form.
    faqs: {
      label: 'question', plural: 'your questions', items: faqs,
      // What a NEW one is made of. The add drawer reads these: a record the
      // owner writes themselves needs to know which keys to write and what to
      // call them, and that belongs to the record TYPE rather than to the
      // editor, which has no idea a question has an answer.
      //
      // ⚠️ The key names are THIS site's — `question` and `answer`, the names
      // the `faq` table uses and the names src/config/editable.js allowlists.
      // rp-launch publishes `q` and `a` here because its content object spells
      // them that way; copying those across would have made the add drawer
      // write two fields nothing reads.
      name: 'question', nameLabel: 'The question', namePlaceholder: 'What do buyers keep asking?',
      body: 'answer', bodyLabel: 'The answer', bodyPlaceholder: 'Answer it the way you would say it out loud.',
      askLabel: 'Ask for a new question',
      askLine: 'Tell us a question buyers keep asking. We write the answer and it appears here.',
    },
  }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
