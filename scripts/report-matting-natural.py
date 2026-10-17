"""Aggregate complete local matting evaluations without redistributing photographs.

Requires NumPy and matplotlib. Reports retain every failure. Quality comparisons
use matched successful cases, never populations selected by different solvers.
Run score-matting-natural.py first; this tool checks its input/output provenance.
"""

import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np


METRICS = [
    'unknownMAE', 'unknownMSE', 'unknownSADDiv1000',
    'gaussianVectorGradientDiv1000', 'seededConnectivityDiv1000',
]
REPO = Path(__file__).resolve().parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quality(case, smoothness):
    return next(output['quality'] for output in case['outputs']
                if output['smoothness'] == smoothness)


def aggregate(cases, smoothness):
    values = [quality(case, smoothness) for case in cases
              if case['status'] == 'success']
    return {
        'successfulCases': len(values),
        'averaging': 'Unweighted arithmetic mean across successful cases; failures excluded from quality only',
        'metrics': {
            key: {
                'mean': float(np.mean(present)) if present else None,
                'definedCases': len(present),
            }
            for key in METRICS
            for present in [[value[key] for value in values if value[key] is not None]]
        },
    }


def load_run(path, manifest, manifest_hash, split, current=False):
    report = json.loads(path.read_text())
    expected = {case['id']: case for case in manifest['cases'] if case['split'] == split}
    ids = [case['id'] for case in report['cases']]
    if (report['manifestSha256'] != manifest_hash or report['split'] != split
            or not report['complete'] or report['expectedCases'] != len(expected)
            or len(ids) != len(set(ids)) or set(ids) != set(expected)):
        raise ValueError(f'Incomplete, duplicate, mismatched or differently scoped run: {path}')
    if current:
        required_sources = {
            'src/intelligence/matting/closed-form.ts', 'src/intelligence/matting/coarse.ts',
            'src/intelligence/matting/iterations.ts', 'src/engine/matting-iterations.ts',
            'src/engine/wasm.ts', 'assembly/matting.ts', 'src/engine/pixels.worker.ts',
            'server/matting-runtime.ts', 'server/matting-worker.mjs', 'src/intelligence/matting/engine.ts',
            'src/engine/matting-tile.ts', 'src/engine/matting-workflow.ts',
            'src/core/matting.ts', 'server/png-rows.ts', 'public/wasm/pixels.wasm',
        }
        if set(report['sourceHashes']) != required_sources:
            raise ValueError('Current candidate must hash every solver, backend and worker integration source.')
        for source, digest in report['sourceHashes'].items():
            if sha(REPO / source) != digest:
                raise ValueError(f'Current source differs from measured candidate: {source}')
    for case in report['cases']:
        item = expected[case['id']]
        if case['status'] not in ['success', 'error']:
            raise ValueError('Every case must have a terminal success or error status.')
        if (case['sourceSha256'] != item['sha256']
                or (case['width'], case['height']) != (item['width'], item['height'])):
            raise ValueError(f'Case provenance mismatch: {case["id"]}')
        if case['status'] != 'success':
            if not case.get('error'):
                raise ValueError('Failures must retain their actual error.')
            continue
        diagnostic = case['diagnostics']
        if current and (diagnostic.get('iterationBackend') not in ['wasm', 'javascript']
                        or not isinstance(diagnostic.get('iterationBytes'), int)
                        or not 0 <= diagnostic['iterationBytes'] <= diagnostic['estimatedGraphBytes']
                        or (diagnostic['iterationBackend'] == 'wasm' and diagnostic['iterationBytes'] == 0)):
            raise ValueError(f'Invalid or absent iteration backend diagnostics: {case["id"]}')
        if (not np.isfinite(diagnostic['relativeResidual'])
                or diagnostic['relativeResidual'] > (1e-9 if diagnostic.get('coarseBlocks', 0) else 1e-7)
                or diagnostic['iterations'] > 2000
                or diagnostic['estimatedGraphBytes'] > 192 * 1024**2):
            raise ValueError(f'Uncertified successful solve: {case["id"]}')
        if sorted(output['smoothness'] for output in case['outputs']) != [0, 10]:
            raise ValueError('Both neutral and default smoothing must be present.')
        for output in case['outputs']:
            if sha(Path(output['path'])) != output['sha256']:
                raise ValueError(f'Measured alpha changed: {output["path"]}')
            scores = output['quality']
            if scores['knownLabelViolations'] or scores['unknownPixels'] != item['unknownPixels']:
                raise ValueError(f'Hard labels or scored region changed: {case["id"]}')
            if any(value is not None and (not np.isfinite(value) or value < 0)
                   for value in (scores[key] for key in METRICS)):
                raise ValueError('Scores must be finite nonnegative values or explicitly undefined.')
    report['summary'] = {
        'expectedCases': len(expected), 'completedCases': len(ids),
        'successes': sum(case['status'] == 'success' for case in report['cases']),
        'failures': [case['id'] for case in report['cases'] if case['status'] == 'error'],
    }
    report['qualityMeans'] = {str(smooth): aggregate(report['cases'], smooth) for smooth in [0, 10]}
    report['rawScoredReportSha256'] = sha(path)
    report['rawScoredReportName'] = path.name
    report = copy.deepcopy(report)
    for case in report['cases']:
        for output in case.get('outputs', []):
            del output['path']  # Do not copy local photograph/alpha locations into portable evidence.
            output.pop('metrics', None)  # Retain the independently scored quality values.
    return report


def direct_checks(paths, raw_development):
    checks = []
    for path in paths:
        reference = json.loads(path.read_text())
        raw = path.with_suffix('.alpha')
        case = next(case for case in raw_development['cases'] if case['id'] == reference['case'])
        output = next(output for output in case['outputs'] if output['smoothness'] == 0)
        if reference['inputHashes'] != case['sourceSha256'] or sha(raw) != reference['alphaSha256']:
            raise ValueError('Independent reference provenance mismatch.')
        a = np.fromfile(raw, np.uint8)
        b = np.fromfile(output['path'], np.uint8)
        if a.size != reference['width'] * reference['height'] or a.shape != b.shape:
            raise ValueError('Independent reference/output geometry mismatch.')
        difference = np.abs(a.astype(np.int16) - b.astype(np.int16))
        maximum, mean = int(difference.max()), float(difference.mean())
        if (not np.isfinite(reference['relativeResidual']) or reference['relativeResidual'] > 1e-7
                or maximum > 1 or mean >= .02):
            raise ValueError('Independent direct-solve conformance failed.')
        checks.append({**reference, 'reportSha256': sha(path),
                       'candidateAlphaSha256': output['sha256'],
                       'maximumByteError': maximum, 'meanByteError': mean})
    return checks


def plot(report, path):
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import pyplot as plt

    plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
    figure, axes = plt.subplots(2, 2, figsize=(13, 9.5), layout='constrained')
    baseline, development, holdout = (report['runs'][key] for key in ['baseline', 'development', 'holdout'])
    runs = [baseline, development, holdout]
    ratios = [sum(case['status'] == 'success' for case in run['cases']) / run['expectedCases'] for run in runs]
    bars = axes[0, 0].bar([report['design']['baselineLabel']+'\ndevelopment', report['design']['candidateLabel']+'\ndevelopment', report['design']['candidateLabel']+'\nreserved public-training'],
                          ratios, color=['#8b9590', '#42674e', '#819e4b'])
    for bar, run in zip(bars, runs):
        count = sum(case['status'] == 'success' for case in run['cases'])
        axes[0, 0].text(bar.get_x() + bar.get_width()/2, bar.get_height()+.025,
                        f'{count}/{run["expectedCases"]}', ha='center')
    axes[0, 0].set(ylim=(0, 1.15), ylabel='Fraction producing a converged matte',
                   title='Availability: all cases retained; cohorts labelled separately')
    matched = report['matchedDevelopment']['cases']
    old = [case['baseline']['unknownMAE'] for case in matched]
    new = [case['candidate']['unknownMAE'] for case in matched]
    limit = max(old + new) * 1.08
    axes[0, 1].plot([0, limit], [0, limit], color='#999999', linewidth=1)
    axes[0, 1].scatter(old, new, color='#42674e', alpha=.8)
    axes[0, 1].set(xlim=(0, limit), ylim=(0, limit), xlabel='Old default unknown-region MAE',
                   ylabel='New default unknown-region MAE', title=f'Matched {len(matched)} successful development cases')
    changes = report['matchedDevelopment']['metrics']
    keys = ['unknownMAE', 'unknownMSE', 'gaussianVectorGradientDiv1000', 'seededConnectivityDiv1000']
    percentages = [changes[key]['relativeChangePercent'] for key in keys]
    bars = axes[1, 0].barh(['Alpha MAE', 'Alpha MSE', 'Local gradient', 'Local connectivity'], percentages,
                           color=['#42674e' if value < 0 else '#ad5642' for value in percentages])
    for bar, value in zip(bars, percentages):
        label = f'{value:+.1f}%' if abs(value) >= .05 else f'{value:+.3g}%'
        axes[1, 0].text(value + (1 if value >= 0 else -1), bar.get_y()+bar.get_height()/2,
                        label, va='center', ha='left' if value >= 0 else 'right')
    axes[1, 0].axvline(0, color='#999999', linewidth=1)
    axes[1, 0].set(xlim=(min(percentages)-8, max(percentages)+10), xlabel='Change in mean error (%) — lower is better',
                   title='Default-output tradeoff on the same matched cases')
    cases = sorted(holdout['cases'], key=lambda case: case['id'])
    axes[1, 1].bar(range(len(cases)), [quality(case, 10)['unknownMAE'] for case in cases], color='#819e4b')
    axes[1, 1].set_xticks(range(len(cases)), [case['id'].replace('-Trimap', '/T') for case in cases], rotation=65, ha='right', fontsize=8)
    axes[1, 1].set(ylabel='Unknown-region MAE, alpha in [0,1]', title='Reserved images: both supplied trimaps, new default')
    figure.suptitle('Canoli Studio — photographed matting evaluation\nPublic AlphaMatting training data; supplied trimaps; local measures', fontsize=15)
    failures = sum(run['summary']['expectedCases']-run['summary']['successes'] for run in [development, holdout])
    figure.supxlabel(f'Not an official hidden-test ranking. {failures} candidate case(s) fail; per-metric changes shown above.\nNo semantic-selection, human-hair/glass/fabric, RGB decontamination or cross-device quality claim.', fontsize=9)
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=160)
    plt.close(figure)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['dataset', 'baseline', 'development', 'holdout', 'output', 'figure']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--direct-reference', type=Path, action='append', default=[])
    parser.add_argument('--browser-output', type=Path)
    parser.add_argument('--baseline-engine-provenance', type=Path)
    parser.add_argument('--validation', type=Path)
    parser.add_argument('--date', required=True)
    parser.add_argument('--baseline-label', default='Jacobi + old Smooth')
    parser.add_argument('--candidate-label', default='IC(0) + new Smooth')
    parser.add_argument('--baseline-description', default='Historical Jacobi CG with full-strength low-value smoothing; candidate combines IC(0) and proportional Smooth, so paired differences do not isolate one change')
    args = parser.parse_args()
    manifest_path = args.dataset / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest_hash = sha(manifest_path)
    runs = {
        'baseline': load_run(args.baseline, manifest, manifest_hash, 'development'),
        'development': load_run(args.development, manifest, manifest_hash, 'development', current=True),
        'holdout': load_run(args.holdout, manifest, manifest_hash, 'holdout', current=True),
    }
    if runs['development']['sourceHashes'] != runs['holdout']['sourceHashes']:
        raise ValueError('Development and holdout must use the same frozen candidate sources.')
    baseline = {case['id']: case for case in runs['baseline']['cases'] if case['status'] == 'success'}
    development = {case['id']: case for case in runs['development']['cases'] if case['status'] == 'success'}
    matched = [{'id': name, 'baseline': quality(baseline[name], 10), 'candidate': quality(development[name], 10)}
               for name in sorted(baseline.keys() & development.keys())]
    changes = {}
    for key in METRICS:
        present = [case for case in matched if case['baseline'][key] is not None and case['candidate'][key] is not None]
        old = float(np.mean([case['baseline'][key] for case in present])) if present else None
        new = float(np.mean([case['candidate'][key] for case in present])) if present else None
        changes[key] = {'pairedCases': len(present), 'baselineMean': old, 'candidateMean': new,
                        'relativeChangePercent': (new / old - 1) * 100 if old else None}
    report = {
        'date': args.date,
        'scope': 'Local development and reserved-image evaluation, not completion of T19 or the full roadmap',
        'dataset': {key: value for key, value in manifest.items() if key != 'cases'},
        'manifestSha256': manifest_hash,
        'design': {
            'holdout': 'IDs divisible by three were originally reserved before tuning; this is now a previously seen public-training validation cohort, not a fresh hidden test. Both trimaps stay with their image; candidate frozen before the current rerun',
            'input': 'Original native PNGs, decoder checked byte-for-byte against independent Pillow RGBA; grayscale trimap levels explicitly mapped into alpha assets',
            'referenceUse': 'Ground truth used only for scoring, never solver input; provided trimaps mean this does not evaluate automatic Subject accuracy',
            'baseline': args.baseline_description,
            'baselineLabel': args.baseline_label,
            'candidateLabel': args.candidate_label,
            'convergence': 'Same original Laplacian, exact hard labels, maximum 2000 CG iterations, actual relative residual <=1e-7, tightened to <=1e-9 with active coarse correction; failures never approximate-success',
            'memory': 'Previous estimated 444-byte reserved-row base retained; optional IC(0) adds 200 bytes/row when it fits. Coarse band/RHS/bookkeeping then optional private WASM vectors/metadata/bookkeeping/prefix/page/transient-chunk estimates fit in spare capacity within the same 192 MiB. Original graph capacity and global JS fallback remain available. GC and whole-process peak memory are not certified by logical graph estimates',
            'timing': 'Individual overlapping container observations, not controlled speed comparisons, p95/input-to-photon, hardware GPU or peak-heap measurements',
        },
        'runs': runs,
        'matchedDevelopment': {'smoothness': 10, 'cases': matched, 'metrics': changes,
                               'interpretation': 'Per-metric changes use only matched successes; no universal quality improvement. Different successful populations must not be compared as aggregate quality gains.'},
        'independentDirectChecks': direct_checks(args.direct_reference, json.loads(args.development.read_text())),
        'remaining': ([
            'Candidate nonconvergence: '+', '.join(case['id'] for name in ['development', 'holdout'] for case in runs[name]['cases'] if case['status'] != 'success'),
        ] if any(case['status'] != 'success' for name in ['development', 'holdout'] for case in runs[name]['cases']) else []) + [
            'Large unknown-region latency, long tasks and broader convergence coverage',
            'Connectivity tradeoff and broader hair/fur/foliage quality acceptance',
            'Real-human hair, glass and translucent-fabric evaluation; natural foreground-RGB decontamination quality',
            'Semantic Select Subject quality, real-user acceptance, wider device/latency and peak-memory gates',
            'All other incomplete professional-editor/AI/workflow/commercial/specialist roadmap requirements',
        ],
    }
    if args.baseline_engine_provenance:
        report['baselinePostprocessSupplement'] = json.loads(args.baseline_engine_provenance.read_text())
    if args.browser_output:
        report['photographedBrowser'] = {path.stem: json.loads(path.read_text())
                                         for path in sorted(args.browser_output.glob('*.json'))}
    if args.validation:
        report['validation'] = json.loads(args.validation.read_text())
    sources = ['scripts/prepare-matting-evaluation.py', 'scripts/benchmark-matting-natural.ts',
               'scripts/score-matting-natural.py', 'scripts/reference-matting-natural.py',
               'scripts/report-matting-natural.py', 'benchmarks/matting-natural.e2e.ts', 'playwright.matting.config.ts']
    report['evaluationSourceHashes'] = {source: sha(REPO / source) for source in sources}
    report['figure'] = args.figure.name
    args.output.parent.mkdir(parents=True, exist_ok=True)
    plot(report, args.figure)
    report['figureSha256'] = sha(args.figure)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps({name: run['summary'] for name, run in runs.items()}))


if __name__ == '__main__':
    main()
