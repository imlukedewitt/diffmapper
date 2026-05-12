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
end
