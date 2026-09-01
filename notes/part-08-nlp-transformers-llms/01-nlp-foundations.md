# Chapter 1 — Classical NLP, Tokenization, and Embeddings

## 1. Text is structured, ambiguous, and contextual

Challenges:

- morphology, spelling, Unicode, scripts;
- word order/syntax;
- polysemy and reference;
- long-range context;
- pragmatics/intent;
- multilingual/code-switching;
- domain change and new terms;
- adversarial text;
- annotation subjectivity.

Start with task/label/data and a strong sparse baseline before assuming a large
language model is required.

## 2. Normalization

Possible steps: Unicode normalization, whitespace, casing, accents, punctuation,
URLs/emails/numbers, language detection, sentence splitting.

Every normalization discards information. Case distinguishes `US`/`us`; punctuation
changes sentiment; homoglyph/zero-width chars matter for security; stemming may
merge distinct domain terms. Keep raw text/version and test transformations.

## 3. Tokenization levels

- character: robust/open vocabulary, long sequences;
- word: interpretable, huge/OOV/morphology;
- subword: balance vocabulary/length;
- byte: universal bytes, potentially longer and less direct semantics.

Common subword ideas:

- BPE merges frequent symbol pairs;
- WordPiece chooses vocabulary by likelihood-like criteria;
- unigram LM starts candidates and prunes under probabilistic objective;
- byte-level variants avoid unknown characters.

Tokenizer is part of model. Changing normalization/vocabulary/IDs invalidates
embedding mapping. Record exact version/special-token behavior.

## 4. Special tokens and masks

Beginning/end, padding, separator, unknown, mask, role/control tokens. Define:

- attention mask;
- loss mask (padding/prompt portions);
- truncation side;
- max length;
- chat template/roles;
- escaping of user content versus control syntax.

Control-token injection can change model interpretation; use official structured
templating and isolate untrusted content.

## 5. Bag of words and n-grams

Document vector counts token occurrences, ignoring long order. n-grams capture
local order. Character n-grams handle spelling/obfuscation.

Vocabulary pruning: minimum/maximum document frequency, max size, reserved unknown.
Fit on training only.

## 6. TF–IDF

Common smoothed form:

> tfidf(t,d) = tf(t,d) · [log((1 + N)/(1 + df(t))) + 1]

Term frequency can be raw, binary, log-scaled; vectors often L2 normalized.
Definitions differ by library.

Strong baseline: word + char TF–IDF with regularized logistic/linear SVM. Fast,
interpretable, robust for classification/search, but limited semantics/context.

## 7. Classical language models

n-gram LM:

> P(w₁…w<sub>T</sub>) ≈ ∏ P(w<sub>t</sub> ∣ w<sub>t−n+1</sub>…w<sub>t−1</sub>)

Counts are sparse; smoothing/backoff (Laplace, Kneser–Ney concepts) allocate mass
to unseen sequences. Neural LMs replace discrete context with learned representation.

## 8. Word embeddings

Distributional hypothesis: words in similar contexts have related meaning.

- Word2Vec CBOW/skip-gram with negative sampling;
- GloVe factorizes/co-models global co-occurrence ratios;
- fastText uses character subword units for morphology/OOV.

Static embeddings assign one vector per token type, cannot resolve polysemy fully.
Analogy arithmetic is dataset/objective-sensitive and can reflect stereotypes.

## 9. Contextual embeddings

Encoder/RNN/transformer produces token vector conditioned on sentence. Pooling for
sentence/document:

- special token;
- mean/max with mask;
- attention pooling;
- model trained specifically for sentence similarity.

Raw LM hidden-state cosine may be poor semantic retrieval. Use contrastively trained
embedding model and evaluate domain retrieval.

## 10. Classical NLP tasks/metrics

- document/sentence classification;
- sequence labeling (POS, NER): token/span F1;
- parsing;
- language modeling: NLL/perplexity;
- translation: BLEU/COMET-like plus human/task checks;
- summarization: ROUGE-like plus factuality/coverage;
- retrieval: recall@K/MRR/NDCG;
- QA: exact match/F1/grounding.

Automatic overlap metrics can reward surface match and miss meaning/factuality.
State tokenization/casing/version.

## 11. Sequence labeling

BIO tags: B-entity, I-entity, O. Invalid sequences need constraints/repair.
Conditional random field (CRF) scores emission + transition and globally normalizes
tag sequence, decoding via Viterbi. Modern transformer token classifiers may use
independent softmax or CRF.

Subword labels require mapping: label first subtoken, propagate, or span-based
objective. Evaluate original entity spans, not token pieces only.

## 12. Data leakage in NLP

- exact/near duplicate documents across split;
- same author/thread/template/campaign;
- pretraining contamination of benchmark;
- future articles for historical prediction;
- label words/artifacts in prompt/template;
- document metadata added after outcome;
- retrieval corpus includes answer annotations/test solutions.

Use document/source/time/group split and near-duplicate hashing/semantic clustering.

## 13. Exercises

1. Compare word/char TF–IDF logistic baselines.
2. Train tokenizer on training only and inspect rare/multilingual segmentation.
3. Calculate n-gram probability with smoothing.
4. Audit a NER pipeline for subword/padding errors.
5. Find near-duplicate leakage in a text dataset.

