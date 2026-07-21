import json
import unittest
from pathlib import Path

import backend_main


class VercelDurationTests(unittest.TestCase):
    def test_garment_generation_budget_fits_function_duration(self):
        config = json.loads(
            (Path(__file__).resolve().parents[1] / "vercel.json").read_text()
        )
        max_duration = config["functions"]["api/index.py"]["maxDuration"]
        longest_stage_budget = max(
            backend_main.GARMENT_IMAGE_TIMEOUT_SECONDS,
            backend_main.OPENAI_QA_TIMEOUT_SECONDS,
        )

        self.assertGreaterEqual(max_duration, longest_stage_budget + 30)


if __name__ == "__main__":
    unittest.main()
