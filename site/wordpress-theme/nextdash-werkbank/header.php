<?php
/**
 * The header: wordmark, menu, search, light/dark and GitHub. The same as the
 * docs header, so moving between /docs/ and the rest of the site is seamless.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
$links = ndw_links();
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="nd-skip" href="#main">Skip to content</a>
<header class="nd-header">
	<div class="nd-wrap nd-header-row">
		<a class="nd-word" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home"><svg class="nd-word-mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7"/><path d="M8.5 10l6 5-6 5" fill="none" stroke="#72ca9d" stroke-width="2.6" stroke-linecap="square"/><rect x="16" y="20.5" width="8" height="2.6" fill="#72ca9d"/></svg>nextDash</a>
		<button type="button" class="nd-menu-toggle" aria-expanded="false" aria-controls="nd-nav">Menu</button>
		<nav class="nd-nav" id="nd-nav" aria-label="Main">
			<ul>
				<?php foreach ( ndw_nav_items() as $item ) : ?>
					<li>
						<a href="<?php echo esc_url( $item['url'] ); ?>"<?php echo ndw_nav_is_current( $item['url'] ) ? ' aria-current="page"' : ''; ?><?php echo empty( $item['external'] ) ? '' : ' rel="noopener"'; ?>>
							<?php echo esc_html( $item['label'] ); ?><?php echo empty( $item['external'] ) ? '' : '<span class="nd-ext" aria-hidden="true"> ↗</span>'; ?>
						</a>
					</li>
				<?php endforeach; ?>
			</ul>
		</nav>
		<div class="nd-tools">
			<form class="nd-search" role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>" data-nd-search>
				<label class="screen-reader-text" for="nd-search-q">Search docs and site</label>
				<span class="nd-search-icon"><?php echo ndw_icon( 'search' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
				<input id="nd-search-q" type="search" name="s" placeholder="Search docs and site" autocomplete="off" spellcheck="false" value="<?php echo esc_attr( get_search_query() ); ?>" aria-controls="nd-search-results" aria-expanded="false">
				<kbd class="nd-search-key" aria-hidden="true">/</kbd>
				<div class="nd-search-results" id="nd-search-results" role="listbox" hidden></div>
			</form>
			<button type="button" class="nd-icon-btn" data-nd-theme aria-label="Switch between light and dark"><?php echo ndw_icon( 'theme' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></button>
			<a class="nd-icon-btn" href="<?php echo esc_url( $links['github'] ); ?>" aria-label="nextDash on GitHub" rel="noopener"><?php echo ndw_icon( 'github' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></a>
		</div>
	</div>
</header>
<main id="main" class="nd-main">
