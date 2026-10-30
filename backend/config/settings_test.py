"""Settings for the test suite: development mode, no .env needed."""

import os

os.environ.setdefault("DJANGO_DEBUG", "true")

from config.settings import *  # noqa: E402, F403
