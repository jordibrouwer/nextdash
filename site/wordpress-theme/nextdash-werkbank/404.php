<?php
/**
 * A page that does not exist.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();
?>
<div class="nd-wrap nd-narrow">
	<header class="nd-page-head">
		<h1>Page not found</h1>
		<p class="nd-lead">This address does not lead anywhere on nextdash.cc. The search in the header looks through the site and the docs.</p>
	</header>
	<p class="nd-btns">
		<a class="nd-btn nd-btn--primary" href="<?php echo esc_url( home_url( '/' ) ); ?>">Home</a>
		<a class="nd-btn" href="<?php echo esc_url( home_url( '/docs/' ) ); ?>">Docs</a>
		<a class="nd-btn" href="<?php echo esc_url( home_url( '/features/' ) ); ?>">Features</a>
	</p>
</div>
<?php
get_footer();
