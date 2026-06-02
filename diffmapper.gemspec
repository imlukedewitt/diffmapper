# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name = "diffmapper"
  spec.version = "0.1.1"
  spec.authors = ["Luke"]
  spec.summary = "Visual diff review tool — generates spatial HTML canvases from git diffs"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1"

  spec.files = Dir["lib/**/*", "bin/*"]
  spec.bindir = "bin"
  spec.executables = ["diffmapper"]
  spec.metadata["rubygems_mfa_required"] = "true"

  spec.add_dependency "dry-initializer", "~> 3.1"
end
