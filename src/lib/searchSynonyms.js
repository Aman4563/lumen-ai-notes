/**
 * Curated ML/AI search synonyms (SEARCH-001, issue #13).
 *
 * Pure query-side expansion: each group's members match as alternates for
 * one another at a dedicated ranking tier below exact and above typo
 * tolerance. Exclusions and field-filter values are never expanded —
 * precision operators stay literal. Directed entries (`oneWay`) map an
 * ambiguous abbreviation to its expansion without the reverse, so senses
 * never cross-pollute (searching "learning rate" must not match "lr" used
 * as something else, but "lr" may find "learning rate").
 *
 * Corpus-informed: British spellings and squashed forms (kmeans) do not
 * appear in the shipped lectures, so ise↔ize and hyphen folds are handled
 * as deterministic transforms here rather than per-word table entries.
 */
const GROUPS = [
  ["neural network", "neural net"],
  ["backpropagation", "backprop"],
  ["stochastic gradient descent", "sgd"],
  ["gradient descent", "steepest descent"],
  ["learning rate", "step size"],
  ["regularization", "weight decay penalty"],
  ["l2 regularization", "ridge"],
  ["l1 regularization", "lasso"],
  ["convolutional neural network", "cnn", "convnet"],
  ["recurrent neural network", "rnn"],
  ["long short-term memory", "lstm"],
  ["transformer", "attention model"],
  ["large language model", "llm"],
  ["reinforcement learning", "rl"],
  ["supervised learning", "labeled learning"],
  ["unsupervised learning", "unlabeled learning"],
  ["overfitting", "memorization"],
  ["generalization", "out-of-sample performance"],
  ["cross-validation", "k-fold"],
  ["hyperparameter", "tuning parameter"],
  ["feature engineering", "feature construction"],
  ["dimensionality reduction", "dimension reduction"],
  ["principal component analysis", "pca"],
  ["singular value decomposition", "svd"],
  ["k-means", "lloyd's algorithm"],
  ["k-nearest neighbors", "knn", "nearest neighbor"],
  ["support vector machine", "svm"],
  ["random forest", "bagged trees"],
  ["gradient boosting", "boosted trees", "xgboost"],
  ["decision tree", "cart"],
  ["logistic regression", "logit model"],
  ["mean squared error", "mse", "squared loss"],
  ["cross-entropy", "log loss"],
  ["maximum likelihood", "mle estimation"],
  ["expectation maximization", "em algorithm"],
  ["bayes theorem", "bayes rule"],
  ["standard deviation", "sigma spread"],
  ["confusion matrix", "error matrix"],
  ["precision recall", "pr curve"],
  ["receiver operating characteristic", "roc"],
  ["area under the curve", "auc"],
  ["natural language processing", "nlp"],
  ["computer vision", "image understanding"],
  ["retrieval augmented generation", "rag"],
  ["fine-tuning", "finetuning"],
  ["prompt engineering", "prompting"],
  ["embedding", "vector representation"],
  ["tokenization", "tokenizing"],
  ["batch normalization", "batchnorm"],
  ["dropout", "unit masking"],
  ["activation function", "nonlinearity"],
  ["rectified linear unit", "relu"],
  ["vanishing gradient", "gradient decay problem"],
  ["exploding gradient", "gradient blowup"],
  ["data leakage", "target leakage"],
  ["distribution shift", "dataset shift", "covariate shift"],
  ["feature store", "feature repository"],
  ["model registry", "model catalog"],
  ["continuous integration", "ci pipeline"],
  ["a/b test", "split test"],
];

/** Ambiguous abbreviations: expansion only, never the reverse. */
const ONE_WAY = new Map([
  ["lr", ["learning rate"]],
  ["cv", ["cross-validation", "computer vision"]],
  ["ann", ["artificial neural network"]],
  ["pos", ["part of speech"]],
  ["nn", ["neural network"]],
  ["gd", ["gradient descent"]],
]);

const index = new Map();
for (const group of GROUPS) {
  for (const member of group) {
    const alternates = group.filter((candidate) => candidate !== member);
    index.set(member, [...(index.get(member) || []), ...alternates]);
  }
}
for (const [abbreviation, expansions] of ONE_WAY) {
  index.set(abbreviation, [...(index.get(abbreviation) || []), ...expansions]);
}

/**
 * Alternates for one already-normalized query term (bounded to 4). Length ≤ 3
 * alternates carry `boundary: true` so the matcher requires word boundaries
 * ("nn" must never match inside "annotation").
 */
export const synonymAlternatesFor = (term) => (index.get(term) || [])
  .slice(0, 4)
  .map((alternate) => ({ text: alternate, boundary: alternate.length <= 3 }));

export const SYNONYM_GROUP_COUNT = GROUPS.length;
