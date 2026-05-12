# frozen_string_literal: true

require "capybara"
require "capybara/cuprite"

Capybara.register_driver(:cuprite) do |app|
  Capybara::Cuprite::Driver.new(app, headless: true, js_errors: true)
end

Capybara.default_driver = :cuprite

module BrowserTestHelper
  def generate_html(diff_fixture: "real_pr.diff", data_overrides: {})
    diff_text = File.read(File.join(__dir__, "../fixtures/diffs", diff_fixture))
    data = Diffmapper::Parser.new(diff_text).call
    data.merge!(data_overrides)
    html = Diffmapper::Renderer.new(data).call

    path = File.join(Dir.tmpdir, "diffmapper_test_#{SecureRandom.hex(4)}.html")
    File.write(path, html)
    path
  end

  def visit_generated_html(**opts)
    path = generate_html(**opts)
    visit "file://#{path}"
    path
  end

  def count_card_overlaps
    rects = card_rects
    count = 0
    rects.each_with_index do |a, i|
      rects[(i + 1)..].each { |b| count += 1 if rects_overlap?(a, b) }
    end
    count
  end

  def card_rects
    page.evaluate_script(<<~JS)
      Array.from(document.querySelectorAll('.card')).map(el => ({
        left: el.offsetLeft, top: el.offsetTop,
        width: el.offsetWidth, height: el.offsetHeight
      }))
    JS
  end

  def card_positions(*ids)
    page.evaluate_script(<<~JS)
      (() => {
        const ids = #{ids.flatten.to_json};

        return Object.fromEntries(ids.map(id => {
          const el = document.getElementById(`card-${id}`);
          return [id, { left: el.offsetLeft, top: el.offsetTop }];
        }));
      })()
    JS
  end

  def rects_overlap?(rect_a, rect_b)
    overlaps_horizontally?(rect_a, rect_b) && overlaps_vertically?(rect_a, rect_b)
  end

  def overlaps_horizontally?(rect_a, rect_b)
    rect_a["left"] < rect_b["left"] + rect_b["width"] && rect_a["left"] + rect_a["width"] > rect_b["left"]
  end

  def overlaps_vertically?(rect_a, rect_b)
    rect_a["top"] < rect_b["top"] + rect_b["height"] && rect_a["top"] + rect_a["height"] > rect_b["top"]
  end
end
