# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name = "diffmapper"
  spec.version = "0.1.0"
  spec.authors = ["Luke"]
  spec.summary = "Visual diff review tool — generates spatial HTML canvases from git diffs"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1"

  spec.files = Dir["lib/**/*"]
end
