"""Retained model-validation cases from the former server's contract tests."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from openbexi_timeline_server.api_common import APIError
from openbexi_timeline_server.api_models import Models

ROOT = Path(__file__).resolve().parents[2]


class ModelValidation(unittest.TestCase):
    def model(self, name):
        return json.loads((ROOT / 'HBDS/templates/models/demos' / (name + '.json')).read_text(encoding='utf-8'))

    def test_every_catalog_model_is_accepted_without_mutation(self):
        validator = Models(ROOT)
        catalog = json.loads((ROOT / 'demos/catalog.json').read_text(encoding='utf-8'))
        for entry in catalog['demos']:
            model = json.loads((ROOT / entry['model']).read_text(encoding='utf-8'))
            before = deepcopy(model)
            self.assertIs(model, validator.validate(model))
            self.assertEqual(before, model)

    def test_structure_time_axes_focus_overviews_and_zones_match_existing_rules(self):
        cases = [
            ('default-dataset', ('bands', 0, 'typo.option'), True),
            ('default-dataset', ('bands', 0, 'range', 'form'), '2026'),
            ('default-dataset', ('bands', 0, 'ticks'), dict(unit='MINUTE', step=0)),
            ('default-dataset', ('bands', 0, 'focus', 'magnification'), 0),
            ('dinausaurs', ('dataSource', 'time', 'direction'), 0),
            ('default-dataset', ('params', 0, 'date'), 'invalid'),
            ('default-dataset', ('params', 0, 'date'), 1e300),
            ('default-dataset', ('bands', 0, 'range', 'to'), '2026-09-12T08:00:00Z'),
            ('default-dataset', ('bands', 0, 'context', 'from'), 'nonsense'),
            ('dinausaurs', ('bands', 0, 'range'), {'from': 40, 'to': 240}),
            ('dinausaurs', ('bands', 0, 'range', 'from'), '?240'),
            ('dinausaurs', ('params', 0, 'date'), 1e300),
            ('religions', ('params', 0, 'date'), '999999'),
            ('religions', ('bands', 0, 'range', 'to'), '-002000-01-01T00:00:00Z'),
            ('jfk', ('bands', 1, 'focus', 1, 'to'), 'invalid'),
            ('jfk', ('bands', 1, 'focus', 1, 'ticks', 'unit'), 'NUMERIC'),
            ('dinausaurs', ('bands', 0, 'ticks', 'unit'), 'YEAR'),
            ('dinausaurs', ('bands', 0, 'tickMinutes'), 10),
            ('default-dataset', ('bands', 0, 'ticks'), dict(unit='MINUTE', step=10)),
            ('religions', ('bands', 0, 'ticks', 'step'), 1.5),
            ('religions', ('bands', 0, 'focus', 'ticks', 'step'), 1.5),
            ('default-dataset', ('bands', 1, 'sourceBands'), ['missing']),
            ('default-dataset', ('bands', 0, 'height'), '101%'),
            ('dinausaurs', ('bands', 0, 'secondaryScale'), dict(format='elapsedYears', origin='1900', step=10)),
            ('monet', ('bands', 0, 'secondaryScale', 'origin'), 'invalid'),
            ('jfk', ('dataSource', 'zones', 0, 'end'), 'invalid'),
            ('jfk', ('dataSource', 'zones', 0, 'end'), '1963-11-22T18:00:00Z'),
        ]
        validator = Models(ROOT)
        for name, path, value in cases:
            with self.subTest(model=name, path=path, value=value):
                model = self.model(name)
                target = model
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaises(APIError) as caught:
                    validator.validate(model)
                self.assertEqual(422, caught.exception.status)

    def test_overview_relationships_required_fields_and_historical_years(self):
        mutations = [
            lambda model: model['params'][0].pop('width'),
            lambda model: model['bands'][1].update(name=model['bands'][0]['name']),
            lambda model: model['bands'][1].update(sourceBands=[model['bands'][1]['name']]),
            lambda model: model['bands'][0].update(sourceBands=[model['bands'][0]['name']]),
            lambda model: (model['bands'][0].update(groupBy='data.satellite'), model['bands'][1].update(sourceBands=[model['bands'][0]['name']])),
            lambda model: model['bands'].pop(1),
            lambda model: model['bands'].pop(0),
        ]
        validator = Models(ROOT)
        for index, mutate in enumerate(mutations):
            with self.subTest(case=index):
                model = self.model('default-dataset')
                mutate(model)
                with self.assertRaises(APIError) as caught:
                    validator.validate(model)
                self.assertEqual(422, caught.exception.status)
        model = self.model('religions')
        model['params'][0]['date'] = '44 BCE'
        self.assertIs(model, validator.validate(model))


if __name__ == '__main__':
    unittest.main()
