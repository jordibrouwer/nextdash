<?php
/**
 * Template Name: Compare
 *
 * nextDash next to six self-hosted dashboards: one table,
 * then a paragraph per tool and what nextDash is good at. The page's own
 * text, if any, stands above the table as its introduction.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

$tools = ndw_compare_tools();
$notes = ndw_compare_notes();
?>
<article class="nd-wrap nd-compare">
	<header class="nd-page-head nd-narrow">
		<h1><?php the_title(); ?></h1>
		<?php
		$intro = trim( (string) get_post_field( 'post_content', get_queried_object_id() ) );
		if ( '' !== $intro ) {
			echo wp_kses_post( wpautop( $intro ) );
		} else {
			echo '<p class="nd-lead">nextDash sits between a start page with a bookmark library and a server dashboard. Here it is next to six self-hosted dashboards, as fairly as we can put it.</p>';
		}
		?>
	</header>

	<ul class="nd-cmp-legend" aria-label="What the marks mean">
		<li><span class="nd-cmp-mark nd-cmp-y"></span>Yes</li>
		<li><span class="nd-cmp-mark nd-cmp-p"></span>Partly</li>
		<li><span class="nd-cmp-mark nd-cmp-n"></span>No</li>
		<li><span class="nd-cmp-mark nd-cmp-u"></span>Not documented</li>
		<li><span class="nd-cmp-mark nd-cmp-x"></span>Not what it is for</li>
	</ul>

	<div class="nd-cmp-scroll" tabindex="0" role="region" aria-label="Comparison table, scrolls sideways">
		<table class="nd-cmp">
			<thead>
				<tr>
					<th scope="col" class="nd-cmp-feature"><span class="screen-reader-text">Feature</span></th>
					<?php foreach ( $tools as $id => $t ) : ?>
						<th scope="col" class="<?php echo 'nextdash' === $id ? 'nd-cmp-us' : ''; ?>">
							<a href="<?php echo esc_url( $t['url'] ); ?>" rel="noopener"><?php echo esc_html( $t['name'] ); ?></a>
							<small><?php echo esc_html( $t['kind'] ); ?></small>
						</th>
					<?php endforeach; ?>
				</tr>
			</thead>
			<?php foreach ( ndw_compare_rows() as $group => $rows ) : ?>
				<tbody>
					<tr class="nd-cmp-group"><th scope="rowgroup" colspan="<?php echo count( $tools ) + 1; ?>"><?php echo esc_html( $group ); ?></th></tr>
					<?php foreach ( $rows as $label => $cells ) : ?>
						<tr>
							<th scope="row" class="nd-cmp-feature"><?php echo esc_html( $label ); ?></th>
							<?php $i = 0; foreach ( array_keys( $tools ) as $id ) : ?>
								<td class="<?php echo 'nextdash' === $id ? 'nd-cmp-us' : ''; ?>"><?php echo ndw_compare_cell( $cells[ $i ] ); // phpcs:ignore WordPress.Security.EscapeOutput ?></td>
							<?php $i++; endforeach; ?>
						</tr>
					<?php endforeach; ?>
				</tbody>
			<?php endforeach; ?>
			<tfoot>
				<tr>
					<th scope="row" class="nd-cmp-feature">Latest release</th>
					<?php foreach ( $tools as $id => $t ) : ?>
						<td class="<?php echo 'nextdash' === $id ? 'nd-cmp-us' : ''; ?>"><span class="nd-cmp-text"><?php echo esc_html( $t['release'] ); ?></span></td>
					<?php endforeach; ?>
				</tr>
			</tfoot>
		</table>
	</div>

	<section class="nd-cmp-notes">
		<h2>The tools, one by one</h2>
		<div class="nd-cmp-cards">
			<?php foreach ( $notes as $id => $n ) : ?>
				<div class="nd-cmp-card">
					<h3><?php echo esc_html( $tools[ $id ]['name'] ); ?> <small><?php echo esc_html( $tools[ $id ]['kind'] ); ?></small></h3>
					<p><b>Good at.</b> <?php echo esc_html( $n[0] ); ?></p>
					<p><b>How nextDash differs.</b> <?php echo esc_html( $n[1] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>
	</section>

	<section class="nd-cmp-short nd-narrow">
		<h2>What nextDash is good at</h2>
		<ul>
			<?php foreach ( ndw_compare_strengths() as $s ) : ?>
				<li><?php echo esc_html( $s ); ?></li>
			<?php endforeach; ?>
		</ul>
		<p class="nd-muted">Checked on <?php echo esc_html( ndw_compare_checked() ); ?> against each project's own documentation, README, compose file and source. Tools change quickly; something marked <em>not documented</em> may well exist. Spotted a mistake? <a href="https://github.com/jordibrouwer/nextdash/discussions" rel="noopener">Tell us in the discussions</a>.</p>
	</section>
</article>
<?php
get_footer();
