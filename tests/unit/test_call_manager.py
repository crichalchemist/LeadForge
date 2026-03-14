import pytest
from leadforge.voice.call_manager import is_business_line


class TestIsBusinessLine:

    def test_valid_10_digit(self):
        assert is_business_line("(773) 555-1234") is True

    def test_valid_11_digit_with_country_code(self):
        assert is_business_line("+1-773-555-1234") is True

    def test_none_phone(self):
        assert is_business_line(None) is False

    def test_empty_phone(self):
        assert is_business_line("") is False

    def test_short_number(self):
        assert is_business_line("555-1234") is False

    def test_digits_only(self):
        assert is_business_line("7735551234") is True
