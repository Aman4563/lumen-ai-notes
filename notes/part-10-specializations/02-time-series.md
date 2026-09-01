# Track 2 — Time Series and Forecasting

## 1. Define the forecast

- unit/series: product-store, sensor, account;
- origin time;
- horizon(s);
- frequency/aggregation;
- target and revisions;
- known-future versus observed-past covariates;
- action/cost;
- required quantiles/intervals;
- hierarchy/reconciliation.

Forecast made at t for y<sub>t+h</sub> cannot use covariate realized after t unless
known/scheduled forecast at t.

## 2. Components

- level;
- trend;
- seasonality;
- cycles;
- holidays/events;
- autocorrelation;
- changepoints;
- irregularity/noise;
- intermittent zeros;
- cross-series dependence.

Additive y = level + seasonal + residual; multiplicative y = level×seasonal×noise
or log-additive, suitable positive proportional seasonality.

## 3. Baselines

- mean/median;
- last value (naïve);
- seasonal naïve ŷ<sub>t+h</sub> = y<sub>t+h−season</sub>;
- drift/trend;
- moving average/exponential smoothing.

Forecast model must beat seasonal naïve across horizons/segments/cost.

## 4. Backtesting

Rolling origins:

```text
train------>| forecast H
train------------>| forecast H
train------------------>| forecast H
```

Expanding or sliding window. Include retraining cadence, feature/label availability,
data revisions, gaps, operational latency. Never random split.

Report per horizon, origin season, series volume/type, intermittent/new series.

## 5. Autocorrelation

Autocovariance lag k:

> γ(k) = Cov(y<sub>t</sub>, y<sub>t−k</sub>)

ACF ρ(k) = γ(k)/γ(0). PACF controls intermediate lags. Trends/seasonality create
spurious persistent ACF; difference/detrend where appropriate.

Stationarity: distribution properties stable over time (weak: mean/covariance
constant/lag-dependent). Many real series nonstationary; methods can model level/
trend without forcing stationarity.

## 6. Differencing

> Δy<sub>t</sub> = y<sub>t</sub> − y<sub>t−1</sub>  
> seasonal Δ<sub>s</sub>y<sub>t</sub> = y<sub>t</sub> − y<sub>t−s</sub>

Removes stochastic trend/seasonality sometimes. Over-differencing adds noise and
complicates inversion. Unit-root tests have limited power/assumptions.

## 7. AR, MA, ARIMA

AR(p):

> y<sub>t</sub> = c + Σ<sub>i=1</sub><sup>p</sup>φ<sub>i</sub>y<sub>t−i</sub> + ε<sub>t</sub>

MA(q): current depends on past shocks:

> y<sub>t</sub> = μ + ε<sub>t</sub> + Σ θ<sub>j</sub>ε<sub>t−j</sub>

ARIMA(p,d,q): difference d then ARMA. SARIMA adds seasonal orders. Requires residual
diagnostics and stable parameter/model selection. Exogenous variables → ARIMAX.

AR “moving average” differs from ordinary rolling average; MA uses unobserved error
terms.

## 8. Exponential smoothing / ETS

Simple exponential level:

> ℓ<sub>t</sub> = αy<sub>t</sub> + (1−α)ℓ<sub>t−1</sub>

Holt adds trend; Holt–Winters trend + additive/multiplicative seasonality. ETS gives
state-space error/trend/seasonality formulations and intervals. Strong interpretable
baseline.

## 9. ML feature-based forecasting

Create supervised rows:

- lags y<sub>t−1</sub>, y<sub>t−7</sub>;
- rolling stats ending before origin;
- calendar/holidays;
- price/promotion known at origin;
- related series/aggregates available;
- static metadata.

Train global model across many series (GBDT/neural). Benefits data sharing/cold
start. Need series identity/scale and point-in-time feature generation.

### Recursive versus direct

- Recursive one-step repeatedly: compact, error accumulation, future lags use own
  predictions.
- Direct one model/output per horizon: no recursive accumulation, more params,
  incoherent horizon paths possible.
- Multi-output/seq2seq predicts all jointly.

## 10. Deep forecasting

- RNN/TCN/transformer/state-space;
- global probabilistic models;
- patch/token time-series transformers;
- N-BEATS-like basis decomposition.

Transformer not automatically best. Long context, many related series, covariates,
and scale can help; simple ETS/GBDT often wins small stable datasets.

## 11. Probabilistic forecasting

Point forecast hides uncertainty. Predict:

- parametric distribution;
- quantiles;
- samples/scenarios;
- conformal intervals.

Quantile calibration: about τ fraction outcomes ≤ predicted τ-quantile. Interval
coverage plus width, by horizon/series/season. Pinball loss.

Conformal methods provide finite-sample marginal coverage under exchangeability/
appropriate sequential assumptions; time dependence/shift needs adapted methods.

## 12. Metrics

- MAE/RMSE;
- MAPE problems at zero;
- WAPE aggregation issues;
- MASE scales by naïve in-sample error, comparable across series;
- RMSSE;
- pinball/CRPS for distributions;
- service/inventory cost.

MASE:

> MASE = mean|forecast error| / mean|y<sub>t</sub> − y<sub>t−season</sub>|

Denominator zero needs policy. Weight metrics by economic importance but also
report tail/small series.

## 13. Intermittent demand

Many zeros plus sporadic sizes. Croston-like methods separately estimate nonzero
size and interval; variants correct bias. Standard MAPE unusable. Evaluate stock/
service cost and aggregation level.

## 14. Hierarchical forecasting

Totals must equal sum of components (product→category→region). Independent forecasts
are incoherent.

- bottom-up;
- top-down allocation;
- middle-out;
- optimal reconciliation (MinT concepts using error covariance).

Hierarchy can change; sparse/new leaves and covariance estimation complicate.

## 15. Causal/exogenous caveats

Future price/promotion/weather may be planned/forecast, not known perfectly. Training
with realized future covariate creates unrealistic advantage. Forecast under
scenarios or use available forecasts. Predictive correlation with promotion does
not estimate counterfactual demand without promotion.

## 16. Drift and retraining

Monitor residual bias/scale/coverage by horizon, changepoints, input availability,
calendar/holiday, new/discontinued series. Retraining window trades history and
adaptation. Backtest retraining cadence and fallback seasonal naïve.

## 17. Exercises

1. Implement seasonal naïve, ETS, ARIMA, GBDT lag model with rolling backtest.
2. Demonstrate future-covariate leakage.
3. Compare recursive/direct multi-horizon errors.
4. Build quantile forecasts and coverage plots.
5. Reconcile product/category totals and evaluate business cost.

