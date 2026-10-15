<?php
/**
 * The footer: one row of links and the small ASCII mark.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
$links = ndw_links();
?>
</main>
<footer class="nd-footer">
	<div class="nd-wrap nd-footer-row">
		<nav class="nd-footer-links" aria-label="Footer">
			<a href="<?php echo esc_url( $links['license'] ); ?>">MIT licence</a>
			<a href="<?php echo esc_url( home_url( '/docs/' ) ); ?>">Docs</a>
			<a href="<?php echo esc_url( home_url( '/news/' ) ); ?>">News</a>
			<a href="<?php echo esc_url( $links['changelog'] ); ?>">Changelog</a>
			<a href="<?php echo esc_url( home_url( '/docs/security-and-self-hosting.html' ) ); ?>">Security</a>
			<a href="<?php echo esc_url( get_feed_link() ); ?>">RSS</a>
			<a href="<?php echo esc_url( $links['github'] ); ?>">GitHub</a>
		</nav>
		<pre class="nd-ascii" aria-hidden="true"><?php echo esc_html( ndw_ascii_mark() ); ?></pre>
	</div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
