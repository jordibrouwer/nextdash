# Dropzone 4 action: drop a link (or text holding one) on the nextDash target.
#
# Dropzone Action Info
# Name: Save to nextDash
# Description: Drop a URL to save it to your nextDash inbox
# Handles: URLs, Text
# Creator: nextDash
# URL: https://github.com/jordibrouwer/nextDash
# Events: Dragged, Clicked
# KeyModifiers: Command
# SkipConfig: No
# RunsSandboxed: No
# Version: 1.0
# MinDropzoneVersion: 3.5
# UniqueID: 8721
# OptionsNIB: ExtendedLogin
# LoginTitle: nextDash address
# LoginPasswordTitle: Capture token (blank if none)

require 'net/http'
require 'uri'

# The address goes in the "username" field of Dropzone's login sheet — it is the
# only free-text field the standard config offers, and asking for it is better
# than shipping an action that works on exactly one machine.
def base_url
  configured = ENV['username'].to_s.strip
  configured.empty? ? 'http://localhost:8080' : configured.chomp('/')
end

def capture_token
  ENV['password'].to_s.strip
end

# Dropzone hands text as well as URLs, and a copied link often arrives with the
# page title around it. Same rule the server uses: the first http(s) address wins.
def first_url(items)
  items.flatten.compact.each do |item|
    match = item.to_s[%r{https?://[^\s<>"']+}]
    return match.sub(/[.,;:!?)\]}'"]+\z/, '') if match
  end
  nil
end

def save(url)
  query = { 'url' => url }
  query['token'] = capture_token unless capture_token.empty?
  uri = URI("#{base_url}/add")
  uri.query = URI.encode_www_form(query)

  response = Net::HTTP.get_response(uri)
  heading = response.body[%r{<h1>(.*?)</h1>}m, 1] || 'nextDash did not answer'
  # Dropzone shows the last $dz.finish text as the notification, so it carries
  # the outcome the page would have shown a person.
  $dz.finish(heading)
  $dz.url(false)
end

def dragged
  $dz.begin('Saving to nextDash…')
  url = first_url($items)
  if url.nil?
    $dz.finish('No web address in what was dropped')
    $dz.url(false)
    return
  end
  save(url)
end

def clicked
  # Clicking the target saves whatever is on the clipboard, which is how a link
  # copied from a chat window gets in without a browser being involved.
  clipboard = `pbpaste`.to_s
  url = first_url([clipboard])
  if url.nil?
    $dz.finish('No web address on the clipboard')
    $dz.url(false)
    return
  end
  $dz.begin('Saving the clipboard to nextDash…')
  save(url)
end
